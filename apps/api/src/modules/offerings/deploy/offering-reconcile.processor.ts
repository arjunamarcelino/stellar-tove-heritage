import { randomUUID } from 'node:crypto';
import { Inject, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { offeringEscrowConfig } from '@config/offering-escrow.config';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { AUDIT_KIND } from '@modules/wallets/audit/audit-log.types';
import {
  OFFERING_REPOSITORY,
  IOfferingRepository,
} from '../repositories/offering-repository.interface';
import {
  OFFERING_APPROVAL_REPOSITORY,
  IOfferingApprovalRepository,
} from '../repositories/offering-approval-repository.interface';
import { OFFERING_ESCROW_DEPLOY_QUEUE, OFFERING_RECONCILE_QUEUE } from '../offering.constants';

/**
 * The single reconcile owner (TOV-154, WS8). DB-only promote sweeps per tick, each bounded by
 * `reconcileBatch` and isolated per item (a single failing row logs + continues, never aborts the tick):
 *   1. Stale-deploying re-drive (todo 283) — `findStaleDeploying(grace)` → re-enqueue the deploy job. The
 *      enqueue is best-effort at approve time (it happens after the DB commit), so a crash / Redis blip /
 *      attempts-exhaustion can leave a row wedged in `deploying` with no live job; this backstop re-drives
 *      it (the deploy processor + adapter self-heal make a re-run idempotent). Restores TOV-233 parity.
 *   2. Window open — `findDueForOpen` → CAS `approved→opened`; audit `OFFERING_OPENED` only on the win.
 *   3. Approval expiry — `findExpiredOfferingIds(ttl)` → soft-delete the live approvals + audit
 *      `OFFERING_APPROVAL_EXPIRED` (offering stays `planned`; a fresh quorum must restart). Excludes rows
 *      that are mid-deploy so sweep 1's re-drive isn't undercut.
 * Only sweep 1 touches Redis (a queue add); no on-chain calls here.
 */
@Processor(OFFERING_RECONCILE_QUEUE, { concurrency: 1 })
export class OfferingReconcileProcessor extends WorkerHost {
  private readonly logger = new Logger(OfferingReconcileProcessor.name);

  constructor(
    @Inject(OFFERING_REPOSITORY) private readonly offerings: IOfferingRepository,
    @Inject(OFFERING_APPROVAL_REPOSITORY) private readonly approvals: IOfferingApprovalRepository,
    @Inject(offeringEscrowConfig.KEY) private readonly cfg: ConfigType<typeof offeringEscrowConfig>,
    @InjectQueue(OFFERING_ESCROW_DEPLOY_QUEUE) private readonly deployQueue: Queue,
    private readonly audit: AuditLogService,
  ) {
    super();
  }

  async process(): Promise<void> {
    await this.sweepStaleDeploying();
    await this.sweepWindowOpen();
    await this.sweepExpiry();
  }

  /** Sweep 0 — re-enqueue offerings wedged in `deploying` past the grace window (no live job). */
  private async sweepStaleDeploying(): Promise<void> {
    const stale = await this.offerings.findStaleDeploying(this.cfg.deployGraceMs, this.cfg.reconcileBatch);
    let requeued = 0;
    for (const o of stale) {
      try {
        // Fresh per-attempt jobId so BullMQ can't dedup against a retained failed/completed job. The
        // deploy processor no-ops unless escrow_deploy_status === 'deploying', so a duplicate is harmless.
        await this.deployQueue.add(
          'deploy',
          { offeringId: o.id },
          {
            jobId: `deploy:${o.id}:${randomUUID()}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: { age: 3600, count: 100 },
            removeOnFail: { age: 86400 },
          },
        );
        requeued += 1;
      } catch (err) {
        this.logger.warn(`reconcile stale-deploy re-enqueue failed [offering=${o.id}]: ${String(err)}`);
      }
    }
    if (requeued > 0) this.logger.warn(`offering reconcile re-enqueued ${requeued}/${stale.length} stale deploy(s)`);
  }

  /** Sweep 1 — promote due `approved` offerings to `opened` (CAS-guarded), auditing only on the win. */
  private async sweepWindowOpen(): Promise<void> {
    const due = await this.offerings.findDueForOpen(this.cfg.reconcileBatch);
    let opened = 0;
    for (const o of due) {
      try {
        await this.offerings.runInTransaction(async (m) => {
          const won = await this.offerings.casOpened(m, o.id);
          if (!won) return;
          await this.audit.record(
            {
              actorType: 'system',
              kind: AUDIT_KIND.OFFERING_OPENED,
              subjectType: 'offering',
              subjectId: o.id,
              payload: {},
            },
            m,
          );
          opened += 1;
        });
      } catch (err) {
        this.logger.warn(`reconcile window-open failed [offering=${o.id}]: ${String(err)}`);
      }
    }
    if (opened > 0) this.logger.log(`offering reconcile opened ${opened}/${due.length} due offering(s)`);
  }

  /** Sweep 2 — expire stale approvals on still-`planned` offerings (soft-delete the live set + audit). */
  private async sweepExpiry(): Promise<void> {
    const ttlMs = this.cfg.ttlDays * 24 * 60 * 60 * 1000;
    const ids = await this.approvals.findExpiredOfferingIds(ttlMs, this.cfg.reconcileBatch);
    let expired = 0;
    for (const id of ids) {
      try {
        await this.offerings.runInTransaction(async (m) => {
          await this.approvals.softDeleteAllForOffering(m, id);
          await this.audit.record(
            {
              actorType: 'system',
              kind: AUDIT_KIND.OFFERING_APPROVAL_EXPIRED,
              subjectType: 'offering',
              subjectId: id,
              payload: {},
            },
            m,
          );
          expired += 1;
        });
      } catch (err) {
        this.logger.warn(`reconcile approval-expiry failed [offering=${id}]: ${String(err)}`);
      }
    }
    if (expired > 0) this.logger.log(`offering reconcile expired approvals on ${expired}/${ids.length} offering(s)`);
  }
}
