import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IsNull } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { ErrorCode } from '@common/enums/error-code.enum';
import { failHttp } from '@common/http/fail-http';
import { IdempotencyStore } from '@common/idempotency/idempotency-store';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { AUDIT_KIND } from '@modules/wallets/audit/audit-log.types';
import { offeringEscrowConfig } from '@config/offering-escrow.config';
import {
  OFFERING_REPOSITORY,
  IOfferingRepository,
} from '@modules/offerings/repositories/offering-repository.interface';
import {
  OFFERING_BID_REPOSITORY,
  IOfferingBidRepository,
} from '@modules/offerings/repositories/offering-bid-repository.interface';
import { Offering } from '@modules/offerings/entities/offering.entity';
import { OFFERING_SETTLE_QUEUE } from '@modules/offerings/offering.constants';
import { computeClearing } from '@modules/offerings/clearing';
import { toClearingInput } from '@modules/offerings/clearing-bid.mapper';
import { ClearingPreviewDto } from './dto/clearing-preview.dto';
import { SettleOfferingResponseDto } from './dto/settle-offering-response.dto';

/**
 * Backoffice settlement surface for primary Offerings (TOV-160, FR-05.05). Split out of
 * `BackofficeOfferingsService` (which owns planning + approval) so each service has one lifecycle concern
 * and its own deps (this one owns the settle queue producer + the bid repo). Pure DB writes + a best-effort
 * enqueue — the async on-chain settlement runs in the settle worker.
 */
@Injectable()
export class BackofficeOfferingSettleService {
  private readonly logger = new Logger(BackofficeOfferingSettleService.name);

  constructor(
    @Inject(OFFERING_REPOSITORY) private readonly offerings: IOfferingRepository,
    @Inject(OFFERING_BID_REPOSITORY) private readonly bids: IOfferingBidRepository,
    @Inject(offeringEscrowConfig.KEY) private readonly escrowCfg: ConfigType<typeof offeringEscrowConfig>,
    @InjectQueue(OFFERING_SETTLE_QUEUE) private readonly settleQueue: Queue,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Read-only clearing dry-run (`GET /offerings/:id/clearing-preview`, TOV-160). Computes P + allocations
   * from the CURRENT escrowed book WITHOUT settling. GATED to a closed bidding window (an open-auction
   * preview would leak the sealed marginal price → front-running); per-collector identity is redacted; every
   * access is audited. Never writes/enqueues.
   */
  async previewClearing(offeringId: string, adminSub: string): Promise<ClearingPreviewDto> {
    const off = await this.offerings.findOneById(offeringId);
    if (!off) throw failHttp(ErrorCode.OFFERING_NOT_FOUND, HttpStatus.NOT_FOUND, 'Offering not found');
    // Only previewable once bidding has ended: an `opened` offering must be past its window, or already
    // `subscribed` (settling). Anything else (planned/approved/settled/canceled) has no live book to clear.
    if (off.status === 'opened') {
      if (off.windowCloseAt > new Date()) {
        throw failHttp(ErrorCode.OFFERING_WINDOW_STILL_OPEN, HttpStatus.CONFLICT, 'Bidding window is still open — cannot preview a live sealed auction');
      }
    } else if (off.status !== 'subscribed') {
      throw failHttp(ErrorCode.OFFERING_NOT_OPEN, HttpStatus.CONFLICT, 'Offering has no clearable bid book');
    }

    const bids = await this.bids.listBidsForClearing(off.id);
    const result = computeClearing(bids.map(toClearingInput), BigInt(off.publicFloat));

    // Access-audit the clearing dry-run (who reviewed which offering's sealed book), BEST-EFFORT (#333):
    // this is a read, not a state change, so a transient audit-write blip must not fail the admin's preview —
    // the comment now matches the behavior (previously the un-caught await made it fail-closed).
    await this.audit
      .record({
        actorType: 'admin',
        actorId: adminSub,
        kind: AUDIT_KIND.OFFERING_CLEARING_PREVIEWED,
        subjectType: 'offering',
        subjectId: off.id,
        payload: { fullySubscribed: result.fullySubscribed, winners: result.winners.length },
      })
      .catch((err) => this.logger.warn(`clearing-preview audit failed [offering=${off.id}]: ${String(err)}`));

    return ClearingPreviewDto.build(off, result);
  }

  /**
   * Trigger settlement (`POST /offerings/:id/settle`, TOV-160). Validates preconditions, CAS-latches
   * `opened → subscribed` (or reclaims a terminally-failed `subscribed` for a re-drive), and enqueues the
   * async settle job (202). Idempotency `begin` precedes state-derived rejections (replay-safe); the result
   * is recorded BEFORE the best-effort enqueue (the stale-subscribed reconcile re-drives a lost enqueue).
   *
   * NB (#339): re-driving a TERMINALLY-FAILED settlement (a `subscribed` offering with `settle_failed_at`
   * set) requires a FRESH `Idempotency-Key` — reusing the original key hits the stored 202 (`replay`) and
   * returns it WITHOUT reclaiming/enqueuing, so nothing happens. Standard idempotency semantics; surfaced
   * here + in the FE API contract because the admin-recovery scenario makes the silent no-op easy to miss.
   */
  async settle(
    offeringId: string,
    adminSub: string,
    idempotencyKey: string,
  ): Promise<SettleOfferingResponseDto> {
    const key = `idem:offering-settle:${adminSub}:${idempotencyKey}`;
    const begin = await this.idempotency.begin(
      key,
      createHash('sha256').update(`${adminSub}|${offeringId}`).digest('hex'),
    );
    if (begin.outcome === 'replay') return begin.body as SettleOfferingResponseDto;
    if (begin.outcome === 'in_flight') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT, HttpStatus.CONFLICT, 'A settle request with this key is still processing');
    }
    if (begin.outcome === 'mismatch') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_MISMATCH, HttpStatus.UNPROCESSABLE_ENTITY, 'Idempotency-Key reused with a different request');
    }
    const { token } = begin;

    let outcome: { off: Offering; clearingPrice: string; winners: number };
    try {
      const off = await this.offerings.findOneById(offeringId);
      if (!off) throw failHttp(ErrorCode.OFFERING_NOT_FOUND, HttpStatus.NOT_FOUND, 'Offering not found');

      // ── State gate ──
      if (off.status === 'settled') {
        throw failHttp(ErrorCode.OFFERING_ALREADY_SETTLED, HttpStatus.CONFLICT, 'Offering is already settled');
      }
      const isRedrive = off.status === 'subscribed' && off.settleFailedAt !== null;
      if (off.status === 'subscribed' && !isRedrive) {
        throw failHttp(ErrorCode.OFFERING_SETTLE_IN_PROGRESS, HttpStatus.CONFLICT, 'A settlement is already in progress');
      }
      if (off.status !== 'opened' && off.status !== 'subscribed') {
        throw failHttp(ErrorCode.OFFERING_NOT_OPEN, HttpStatus.CONFLICT, 'Offering is not open for settlement');
      }
      // Fresh (opened) path requires a CLOSED window.
      if (off.status === 'opened' && off.windowCloseAt > new Date()) {
        throw failHttp(ErrorCode.OFFERING_WINDOW_STILL_OPEN, HttpStatus.CONFLICT, 'Bidding window is still open');
      }
      // Escrow must be deployed (a pure DB check — no chain port on this surface). 409, not 503: this is a
      // stable precondition (an immediate client retry won't help — the escrow deploy must complete first),
      // consistent with the surrounding state gates (#335).
      if (!off.escrowContractAddress || off.escrowDeployStatus !== 'deployed') {
        throw failHttp(ErrorCode.OFFERING_ESCROW_UNAVAILABLE, HttpStatus.CONFLICT, 'Offering escrow is not deployed');
      }

      // ── Book gates (fast-fail; the worker re-asserts authoritatively post-close) ──
      const inflight = await this.bids.countInflight(off.id);
      if (inflight > 0) {
        throw failHttp(ErrorCode.OFFERING_HAS_INFLIGHT_BIDS, HttpStatus.CONFLICT, `${inflight} in-flight bid(s) — settle once they drain`);
      }
      const activeCount = await this.bids.countActiveForOffering(off.id);
      if (activeCount > this.escrowCfg.maxBidsPerOffering) {
        throw failHttp(ErrorCode.OFFERING_TOO_MANY_BIDS, HttpStatus.CONFLICT, `Offering has ${activeCount} bids (max ${this.escrowCfg.maxBidsPerOffering} settleable in one tx)`);
      }
      // Compute the clearing over the loaded book: `fullySubscribed` IS the authoritative undersubscription
      // signal (Σ escrowed count == public_float exactly), so no separate demand query is needed (#329). This
      // is advisory for the 202 body; the worker recomputes authoritatively post-close.
      const bids = await this.bids.listBidsForClearing(off.id);
      const result = computeClearing(bids.map(toClearingInput), BigInt(off.publicFloat));
      if (!result.fullySubscribed || result.clearingPriceStroops === null) {
        throw failHttp(ErrorCode.OFFERING_UNDERSUBSCRIBED, HttpStatus.UNPROCESSABLE_ENTITY, 'Offering is undersubscribed — cannot settle');
      }

      // ── Latch (FOR UPDATE serializes concurrent settle triggers) ──
      const claimed = await this.offerings.runInTransaction(async (manager) => {
        const locked = await manager.getRepository(Offering).findOne({
          where: { id: off.id, deletedAt: IsNull() },
          lock: { mode: 'pessimistic_write' },
        });
        if (!locked) return false;
        if (isRedrive) {
          // Reclaim: clear the failure stamps so the row is settle-able again (setSettleFailureStamp(null)).
          return this.offerings.setSettleFailureStamp(manager, off.id, null);
        }
        return this.offerings.casSubscribed(manager, off.id);
      });
      if (!claimed) {
        // Lost a race (another trigger latched it, or the window/status shifted under the lock).
        throw failHttp(ErrorCode.OFFERING_SETTLE_IN_PROGRESS, HttpStatus.CONFLICT, 'A settlement was just latched by another request');
      }
      const settling = (await this.offerings.findOneById(off.id)) ?? off;
      outcome = { off: settling, clearingPrice: result.clearingPriceStroops, winners: result.winners.length };
    } catch (err) {
      await this.idempotency.fail(key, token);
      throw err;
    }

    // The latch committed. Record the 202 BEFORE the enqueue so a same-key retry replays it; the enqueue is
    // best-effort (the stale-subscribed reconcile re-drives a lost enqueue), never fatal.
    const body = SettleOfferingResponseDto.build(outcome.off, outcome.clearingPrice, outcome.winners);
    await this.idempotency.complete(key, token, body).catch((err) => {
      this.logger.warn(`settle idempotency.complete failed [offering=${offeringId}]: ${String(err)}`);
    });
    try {
      await this.settleQueue.add(
        'settle',
        { offeringId },
        {
          jobId: `settle:${offeringId}:${randomUUID()}`,
          attempts: 8,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 3600, count: 100 },
          removeOnFail: { age: 86400 },
        },
      );
    } catch (err) {
      this.logger.warn(
        `settle enqueue failed [offering=${offeringId}]; reconcile will re-drive: ${String(err)}`,
      );
    }
    return body;
  }
}
