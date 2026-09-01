import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { AUDIT_KIND } from '@modules/wallets/audit/audit-log.types';
import { TimelineEmitService } from '@modules/timeline/timeline-emit.service';
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
import {
  FractionSequenceError,
  FractionThrottledError,
} from '../soroban-fraction-factory.service';
import { computeLockupUntil, computeRetentionAmount, TokenInitInput } from '../token-init';
import { FRACTION_DEPLOY_QUEUE } from '../fraction.constants';

interface DeployJobData {
  fractionContractId: string;
}

/** Bounded, single-line failure reason for the append-only audit — never the raw SDK error. */
function sanitizeReason(err: unknown): string {
  const name = err instanceof Error ? err.constructor.name : 'Error';
  const msg = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').trim();
  return `${name}: ${msg}`.slice(0, 200);
}

/**
 * Deploys a per-artwork FractionToken (TOV-233). `concurrency: 1` because every deploy serializes on the
 * relayer account; `lockDuration` exceeds the worst-case wall-clock so a slow-but-live deploy is never
 * declared stalled and double-run. Self-heals via `token_of`; latches the result + advances the artwork
 * in one CAS transaction (source-of-truth = fraction_contracts, artworks = derived latch).
 */
@Processor(FRACTION_DEPLOY_QUEUE, {
  concurrency: 1,
  lockDuration: 90_000,
  stalledInterval: 30_000,
  maxStalledCount: 1,
})
export class FractionDeployProcessor extends WorkerHost {
  private readonly logger = new Logger(FractionDeployProcessor.name);

  constructor(
    @Inject(FRACTION_CONTRACT_REPOSITORY) private readonly contracts: IFractionContractRepository,
    @Inject(ARTWORK_REPOSITORY) private readonly artworks: IArtworkRepository,
    @Inject(FRACTION_FACTORY_SERVICE) private readonly factory: IFractionFactoryService,
    private readonly audit: AuditLogService,
    private readonly timeline: TimelineEmitService,
  ) {
    super();
  }

  async process(job: Job<DeployJobData>): Promise<void> {
    const row = await this.contracts.findOneById(job.data.fractionContractId);
    if (!row || row.status !== 'deploying') return; // already latched / no-op

    const deployTs = Math.floor(Date.now() / 1000);
    const artistRetentionAmount = computeRetentionAmount(row.totalSupply, row.artistRetentionPct);
    const treasuryRetentionAmount = computeRetentionAmount(row.totalSupply, row.treasuryRetentionPct);
    const init: TokenInitInput = {
      artworkId: row.artworkId,
      name: row.tokenName,
      symbol: row.tokenSymbol,
      artistAddress: row.artistAddress,
      artistRetentionAmount,
      treasuryRetentionAmount,
      artistLockupUntil: computeLockupUntil(deployTs, row.artistLockupDays),
      treasuryLockupUntil: computeLockupUntil(deployTs, row.treasuryLockupDays),
    };

    // NOTE: the `: string | null` annotation is load-bearing — capturedTxHash is assigned ONLY inside the
    // onTxHash closure, so control-flow analysis can't infer the type; do NOT "simplify" to `= null`.
    let capturedTxHash: string | null = null;
    let deployed: { tokenAddress: string; deployLedger: string | null } | null = null;
    try {
      const result = await this.factory.deployFractionToken({
        artworkId: row.artworkId,
        init,
        onTxHash: (txHash) => {
          capturedTxHash = txHash;
          return this.contracts.setTxHash(row.id, txHash);
        },
      });
      await this.latchDeployed(row.id, row.artworkId, {
        tokenAddress: result.tokenAddress,
        deployLedger: result.deployLedger,
        artistRetentionAmount,
        treasuryRetentionAmount,
        artistLockupUntil: init.artistLockupUntil,
      });
      deployed = { tokenAddress: result.tokenAddress, deployLedger: result.deployLedger };
    } catch (err) {
      // Transient — let BullMQ retry with backoff (row stays `deploying`).
      if (err instanceof FractionThrottledError || err instanceof FractionSequenceError) {
        this.logger.warn(`fraction deploy transient failure [contract=${row.id}]: ${String(err)}`);
        throw err;
      }
      // Terminal — latch failed + revert the artwork, then stop retrying. The persisted reason is
      // sanitized (bounded, single-line): raw @stellar/stellar-sdk errors can carry XDR blobs / RPC
      // bodies / tx envelopes, and internal_audit_log is append-only + un-redactable.
      await this.latchFailed(row.id, row.artworkId, sanitizeReason(err));
      throw new UnrecoverableError(`fraction deploy failed [contract=${row.id}]: ${String(err)}`);
    }

    // Best-effort, post-commit provenance event (TOV-191, review #401) — OUTSIDE the try/catch so a timeline
    // emit can never be misclassified as a deploy failure (latchFailed) on an already-latched success. The
    // emit service is itself log-not-throw; idempotent via source_ref. Reached only on the success path.
    if (deployed) {
      await this.timeline.emitFractionalizationDeployed({
        artworkId: row.artworkId,
        fractionContractId: row.id,
        tokenAddress: deployed.tokenAddress,
        deployLedger: deployed.deployLedger,
        txHash: capturedTxHash,
      });
    }
  }

  private async latchDeployed(
    contractId: string,
    artworkId: string,
    latch: {
      tokenAddress: string;
      deployLedger: string | null;
      artistRetentionAmount: string;
      treasuryRetentionAmount: string;
      artistLockupUntil: string;
    },
  ): Promise<void> {
    await this.contracts.runInTransaction(async (manager) => {
      const won = await this.contracts.casDeployed(manager, contractId, latch);
      if (!won) return; // another writer (reconciler/retry) already latched
      const advanced = await this.artworks.casStatus(manager, artworkId, 'fractionalizing', 'fractionalized');
      if (!advanced) {
        // Source-of-truth (contract) advanced but the derived latch (artwork) didn't — the artwork left
        // `fractionalizing` externally (currently unreachable given the soft-delete trigger). Surface it.
        this.logger.warn(
          `fraction latch divergence: contract=${contractId} deployed but artwork=${artworkId} not in fractionalizing`,
        );
      }
      await this.audit.record(
        {
          actorType: 'system',
          kind: AUDIT_KIND.ARTWORK_FRACTIONALIZATION_DEPLOYED,
          subjectType: 'artwork',
          subjectId: artworkId,
          payload: { fractionContractId: contractId, tokenAddress: latch.tokenAddress, deployLedger: latch.deployLedger },
        },
        manager,
      );
    });
  }

  private async latchFailed(contractId: string, artworkId: string, reason: string): Promise<void> {
    await this.contracts.runInTransaction(async (manager) => {
      const won = await this.contracts.casFailed(manager, contractId);
      if (!won) return;
      await this.artworks.casStatus(manager, artworkId, 'fractionalizing', 'verified');
      await this.audit.record(
        {
          actorType: 'system',
          kind: AUDIT_KIND.ARTWORK_FRACTIONALIZATION_FAILED,
          subjectType: 'artwork',
          subjectId: artworkId,
          payload: { fractionContractId: contractId, reason },
        },
        manager,
      );
    });
  }
}
