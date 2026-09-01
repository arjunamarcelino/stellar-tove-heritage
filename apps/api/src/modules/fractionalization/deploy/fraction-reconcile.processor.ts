import { Inject, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { fractionFactoryConfig } from '@config/fraction-factory.config';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { AUDIT_KIND } from '@modules/wallets/audit/audit-log.types';
import {
  ARTWORK_REPOSITORY,
  IArtworkRepository,
} from '../repositories/artwork-repository.interface';
import {
  FRACTION_CONTRACT_REPOSITORY,
  IFractionContractRepository,
} from '../repositories/fraction-contract-repository.interface';
import {
  FRACTION_FACTORY_SERVICE,
  IFractionFactoryService,
} from '../fraction-factory.service.interface';
import { FRACTION_RECONCILE_QUEUE } from '../fraction.constants';
import { computeRetentionAmount } from '../token-init';

/**
 * Crash-window backstop (TOV-233): the single reconcile owner. Promote-ONLY — for `deploying` rows
 * stuck past the grace window whose token now exists on-chain (`token_of`), CAS `deploying→deployed`
 * and advance the artwork in the same txn. Never demotes (a slow-but-live deploy stays `deploying`;
 * only the worker's terminal path fails a row). `deploy_ledger` is null on this path (unrecoverable).
 */
@Processor(FRACTION_RECONCILE_QUEUE, { concurrency: 1 })
export class FractionReconcileProcessor extends WorkerHost {
  private readonly logger = new Logger(FractionReconcileProcessor.name);

  constructor(
    @Inject(fractionFactoryConfig.KEY) private readonly cfg: ConfigType<typeof fractionFactoryConfig>,
    @Inject(FRACTION_CONTRACT_REPOSITORY) private readonly contracts: IFractionContractRepository,
    @Inject(ARTWORK_REPOSITORY) private readonly artworks: IArtworkRepository,
    @Inject(FRACTION_FACTORY_SERVICE) private readonly factory: IFractionFactoryService,
    private readonly audit: AuditLogService,
  ) {
    super();
  }

  /** Bounded fan-out for the independent registry reads within one tick. */
  private static readonly READ_CHUNK = 5;

  async process(): Promise<void> {
    const stale = await this.contracts.findStaleDeploying(this.cfg.reconcileGraceMs, this.cfg.reconcileBatch);

    // Resolve token_of for all stale rows with bounded parallelism; a single failing read (RPC blip /
    // transient throttle from token_of) must NOT abort the whole tick, so each is isolated.
    const resolved: Array<{ row: (typeof stale)[number]; tokenAddress: string }> = [];
    for (let i = 0; i < stale.length; i += FractionReconcileProcessor.READ_CHUNK) {
      const chunk = stale.slice(i, i + FractionReconcileProcessor.READ_CHUNK);
      const reads = await Promise.all(
        chunk.map(async (row) => {
          try {
            const tokenAddress = await this.factory.tokenOf(row.artworkId);
            return tokenAddress ? { row, tokenAddress } : null;
          } catch (err) {
            this.logger.warn(`reconcile token_of failed [contract=${row.id}]: ${String(err)}`);
            return null;
          }
        }),
      );
      for (const r of reads) if (r) resolved.push(r);
    }

    // Promote sequentially (cheap CAS writes; keeps the single-writer transition story simple).
    let promoted = 0;
    for (const { row, tokenAddress } of resolved) {
      await this.contracts.runInTransaction(async (manager) => {
        const won = await this.contracts.casDeployed(manager, row.id, {
          tokenAddress,
          deployLedger: null, // unrecoverable on the reconcile path
          // Recompute the exact amounts the worker would have latched — NOT '0'. On this crash-window
          // path these columns are still NULL, but the token was deployed on-chain with the real
          // floor(totalSupply × pct/100) amounts; writing 0 would permanently diverge from the chain.
          artistRetentionAmount: computeRetentionAmount(row.totalSupply, row.artistRetentionPct),
          treasuryRetentionAmount: computeRetentionAmount(row.totalSupply, row.treasuryRetentionPct),
          // The true on-chain deploy time is unrecoverable here → leave the lockup anchor NULL (TOV-33 gate
          // treats null as "not subject"; the on-chain FractionToken remains the hard lockup backstop).
          artistLockupUntil: null,
        });
        if (!won) return;
        await this.artworks.casStatus(manager, row.artworkId, 'fractionalizing', 'fractionalized');
        await this.audit.record(
          {
            actorType: 'system',
            kind: AUDIT_KIND.ARTWORK_FRACTIONALIZATION_DEPLOYED,
            subjectType: 'artwork',
            subjectId: row.artworkId,
            payload: { fractionContractId: row.id, tokenAddress, provenance: 'reconcile' },
          },
          manager,
        );
        promoted += 1;
      });
    }
    if (promoted > 0) this.logger.log(`fraction reconcile promoted ${promoted}/${stale.length} stale row(s)`);
  }
}
