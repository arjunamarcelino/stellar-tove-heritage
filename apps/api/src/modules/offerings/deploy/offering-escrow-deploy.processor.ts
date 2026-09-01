import { Inject, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { AUDIT_KIND } from '@modules/wallets/audit/audit-log.types';
import {
  FRACTION_CONTRACT_REPOSITORY,
  IFractionContractRepository,
} from '@modules/fractionalization/repositories/fraction-contract-repository.interface';
import { offeringEscrowConfig } from '@config/offering-escrow.config';
import {
  OFFERING_REPOSITORY,
  IOfferingRepository,
} from '../repositories/offering-repository.interface';
import {
  OFFERING_APPROVAL_REPOSITORY,
  IOfferingApprovalRepository,
} from '../repositories/offering-approval-repository.interface';
import {
  OFFERING_ESCROW_SERVICE,
  IOfferingEscrowService,
} from '../escrow/offering-escrow.service.interface';
import {
  EscrowParamDriftError,
  OfferingEscrowError,
} from '../escrow/offering-escrow.errors';
import { OFFERING_ESCROW_DEPLOY_QUEUE } from '../offering.constants';
import { sanitizeReason } from '../sanitize-reason';
import { assertPublicFloatMatches, mapConstructorArgs } from './offering-escrow-args.mapper';

interface DeployJobData {
  offeringId: string;
}

/**
 * Deploys the per-offering `OfferingEscrow` contract once a 2-of-3 admin quorum claimed the deploy
 * (TOV-154, WS7). Mirrors `FractionDeployProcessor`: `concurrency: 1` because every deploy serializes on
 * the shared escrow admin/source account; `lockDuration` exceeds the worst-case wall-clock so a
 * slow-but-live deploy is never declared stalled and double-run. Money-routing belts run before any
 * on-chain call. On success it latches `escrow_deploy_status → deployed` AND `status planned → approved`
 * in one CAS txn (and soft-deletes the approval set in the same txn); window-open is owned by the
 * reconcile sweep (Enhancement #6) — no delayed job is enqueued here.
 */
@Processor(OFFERING_ESCROW_DEPLOY_QUEUE, {
  concurrency: 1,
  lockDuration: 90_000,
  stalledInterval: 30_000,
  maxStalledCount: 1,
})
export class OfferingEscrowDeployProcessor extends WorkerHost {
  private readonly logger = new Logger(OfferingEscrowDeployProcessor.name);

  constructor(
    @Inject(OFFERING_REPOSITORY) private readonly offerings: IOfferingRepository,
    @Inject(OFFERING_APPROVAL_REPOSITORY) private readonly approvals: IOfferingApprovalRepository,
    @Inject(FRACTION_CONTRACT_REPOSITORY)
    private readonly fractionContracts: IFractionContractRepository,
    @Inject(OFFERING_ESCROW_SERVICE) private readonly escrow: IOfferingEscrowService,
    @Inject(offeringEscrowConfig.KEY)
    private readonly cfg: ConfigType<typeof offeringEscrowConfig>,
    private readonly audit: AuditLogService,
  ) {
    super();
  }

  async process(job: Job<DeployJobData>): Promise<void> {
    const off = await this.offerings.findOneById(job.data.offeringId);
    if (!off || off.escrowDeployStatus !== 'deploying') return; // already latched / no-op

    const fc = await this.fractionContracts.findOneById(off.fractionContractId);
    if (!fc) {
      // The FK guarantees the row exists; a missing row is an unrecoverable data fault, not retryable.
      throw new EscrowParamDriftError(
        `offering ${off.id}: fraction_contracts ${off.fractionContractId} not found`,
      );
    }

    // Money-routing belts (Enhancement #1 + learning #5). Both throw a typed, terminal error → no deploy:
    // the public_float identity (supply/retentions) and the attested artist/payout recipient must not have
    // drifted between quorum and deploy.
    try {
      assertPublicFloatMatches(off, fc);
      if (off.snapshotArtistAddress !== fc.artistAddress) {
        throw new EscrowParamDriftError(
          `offering ${off.id}: attested artist address drifted (snapshot=${String(
            off.snapshotArtistAddress,
          )} live=${fc.artistAddress})`,
        );
      }

      const res = await this.escrow.deployEscrow({
        offeringId: off.id,
        args: mapConstructorArgs(off, fc, this.cfg),
      });

      await this.offerings.runInTransaction(async (m) => {
        // One CAS: escrow_deploy_status deploying→deployed + status planned→approved + record address.
        const won = await this.offerings.casEscrowDeployed(m, off.id, {
          address: res.contractAddress,
        });
        if (!won) return; // a reconciler/retry already latched this offering
        // Soft-delete the pending approval set in the SAME txn (Enhancement #11) — keeps the expiry index
        // small; the signer history is preserved in the append-only audit log.
        await this.approvals.softDeleteAllForOffering(m, off.id);
        await this.audit.record(
          {
            actorType: 'system',
            kind: AUDIT_KIND.OFFERING_ESCROW_DEPLOYED,
            subjectType: 'offering',
            subjectId: off.id,
            payload: { contractAddress: res.contractAddress, txHash: res.txHash },
          },
          m,
        );
      });
    } catch (err) {
      // Transient — let BullMQ retry with backoff (row stays `deploying`).
      if (err instanceof OfferingEscrowError && err.retryable) {
        this.logger.warn(`offering escrow deploy transient failure [offering=${off.id}]: ${String(err)}`);
        throw err;
      }
      // Terminal — latch `failed` (status stays `planned` → re-approvable, Enhancement #4) + audit, then
      // stop retrying. The persisted reason is sanitized (bounded, single-line): raw @stellar/stellar-sdk
      // errors can carry XDR blobs / RPC bodies / tx envelopes, and internal_audit_log is append-only.
      await this.offerings.runInTransaction(async (m) => {
        await this.offerings.casEscrowFailed(m, off.id);
        await this.audit.record(
          {
            actorType: 'system',
            kind: AUDIT_KIND.OFFERING_ESCROW_DEPLOY_FAILED,
            subjectType: 'offering',
            subjectId: off.id,
            payload: { reason: sanitizeReason(err) },
          },
          m,
        );
      });
      throw new UnrecoverableError(`offering escrow deploy failed [offering=${off.id}]: ${String(err)}`);
    }
  }
}
