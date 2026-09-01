import { Inject, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { AUDIT_KIND } from '@modules/wallets/audit/audit-log.types';
import { offeringEscrowConfig } from '@config/offering-escrow.config';
import {
  OFFERING_REPOSITORY,
  IOfferingRepository,
} from '../repositories/offering-repository.interface';
import {
  OFFERING_BID_REPOSITORY,
  IOfferingBidRepository,
} from '../repositories/offering-bid-repository.interface';
import {
  OFFERING_CLEARING_AUDIT_REPOSITORY,
  IOfferingClearingAuditRepository,
} from '../repositories/offering-clearing-audit-repository.interface';
import {
  OFFERING_ESCROW_SERVICE,
  IOfferingEscrowService,
} from '../escrow/offering-escrow.service.interface';
import {
  OfferingEscrowError,
  OfferingEscrowThrottledError,
  OfferingSettleContractError,
} from '../escrow/offering-escrow.errors';
import { Offering } from '../entities/offering.entity';
import {
  ClearingResult,
  assertClearingInvariants,
  computeClearing,
  toAllocationMap,
} from '../clearing';
import { toClearingInput } from '../clearing-bid.mapper';
import { sanitizeReason } from '../sanitize-reason';
import { OFFERING_SETTLE_QUEUE } from '../offering.constants';

interface SettleJobData {
  offeringId: string;
}

/** Compile-time exhaustiveness guard — a new `OfferingEscrowStatus` variant makes the switch a build error. */
function assertNever(x: never): never {
  throw new Error(`unhandled escrow status: ${String(x)}`);
}

/**
 * A DETERMINISTIC persist-time invariant break (the book shifted mid-settle — a winner is no longer escrowed,
 * or the winners+lost count doesn't reconcile). Distinct type so the classifier terminalizes it (re-driving
 * would hit the same break) while an untyped/transient error stays retryable.
 */
class SettleInvariantError extends Error {}

/**
 * Terminal iff the failure is DETERMINISTIC (re-driving yields the same result): a domain escrow error the
 * adapter marked non-retryable (contract revert, resource exhaustion, WASM mismatch), a `RangeError` from the
 * clearing invariants/overflow/band belt, or a persist-time `SettleInvariantError`. Everything else (unknown,
 * transient infra) is retryable.
 */
function isTerminalSettleError(err: unknown): boolean {
  if (err instanceof OfferingEscrowError) return !err.retryable;
  return err instanceof RangeError || err instanceof SettleInvariantError;
}


/**
 * Settles a fully-subscribed primary Offering (TOV-160, FR-05.05): computes the uniform clearing price,
 * calls the on-chain `close_and_settle`, and records the `offering_clearing_audit` snapshot + the bid
 * won/lost flip ATOMICALLY with the `subscribed → settled` CAS. `concurrency: 1` (every leg serializes on
 * the shared escrow admin account); `lockDuration` covers TWO on-chain txs.
 *
 * **Self-heal-first**: `readStatus()` is read at the top of every attempt (settlement is on-chain
 * idempotent — the contract flips `Status=Settled` before any external call and re-`close_and_settle`
 * hits `AlreadySettled`), so `Settled` → adopt, `Open` → close-then-settle, `Closed` → settle. **Money
 * safety**: a retryable error (RPC timeout / txBadSeq / throttle / poll timeout / in-flight draining)
 * re-throws → BullMQ backoff, offering stays `subscribed` (the next attempt adopts if it actually landed).
 * A deterministic failure (contract revert, resource exhaustion, i128 overflow, band/invariant violation)
 * stamps `OFFERING_SETTLE_FAILED` + leaves the offering `subscribed` (never partially settled — the tx is
 * atomic) and stops retrying.
 *
 * SLO / SCALING (TOV-160 #325): `concurrency:1` + the shared `OFFERING_ESCROW_LOCK_KEY` serialize EVERY
 * settlement GLOBALLY (across all offerings, sharing the lock with escrow deploys), because they all use the
 * one escrow admin account as tx source and Soroban allows one tx per source-account per ledger. Two on-chain
 * txs per settlement (close_offering + close_and_settle) ⇒ ~0.5–2 settlements/min; a batch of offerings whose
 * windows close together settles serially. Mitigation today: stagger `window_close_at` / accept the latency
 * (see the deploy runbook §6). SHARDING SEAM (future, not enabled): partition the settle queue across N
 * distinct escrow-admin SOURCE accounts (each its own lock key) for N-way parallelism — requires N funded
 * Stellar accounts + secrets. This is the only lever; raising `concurrency` alone would just cause txBadSeq.
 */
@Processor(OFFERING_SETTLE_QUEUE, {
  concurrency: 1,
  lockDuration: 180_000,
  stalledInterval: 30_000,
  maxStalledCount: 1,
})
export class OfferingSettleProcessor extends WorkerHost {
  private readonly logger = new Logger(OfferingSettleProcessor.name);

  constructor(
    @Inject(OFFERING_REPOSITORY) private readonly offerings: IOfferingRepository,
    @Inject(OFFERING_BID_REPOSITORY) private readonly bids: IOfferingBidRepository,
    @Inject(OFFERING_CLEARING_AUDIT_REPOSITORY)
    private readonly clearingAudit: IOfferingClearingAuditRepository,
    @Inject(OFFERING_ESCROW_SERVICE) private readonly escrow: IOfferingEscrowService,
    @Inject(offeringEscrowConfig.KEY) private readonly cfg: ConfigType<typeof offeringEscrowConfig>,
    private readonly audit: AuditLogService,
  ) {
    super();
  }

  async process(job: Job<SettleJobData>): Promise<void> {
    const off = await this.offerings.findOneById(job.data.offeringId);
    if (!off || off.status !== 'subscribed') return; // no-op unless in the settle latch (crash-replay safe)
    const escrowAddr = off.escrowContractAddress;
    if (!escrowAddr) {
      // Precondition guarantees an escrow address on a subscribed offering; a null here is unrecoverable.
      await this.fail(off.id, 'no escrow contract address on subscribed offering');
      throw new UnrecoverableError(`offering ${off.id}: no escrow address`);
    }

    try {
      // ── Self-heal-first: on-chain status is authoritative. Exhaustive switch (a new Status variant is a
      //    COMPILE error via assertNever, not a silent fall-through to a money mint, TOV-160 #322). ──
      const status = await this.escrow.readStatus(escrowAddr);
      let adopted = false;
      switch (status) {
        case 'settled':
          adopted = true; // crash-after-landing → recompute + persist as an adopted snapshot
          break;
        case 'open':
          await this.escrow.closeOffering({ offeringId: off.id, escrowAddress: escrowAddr });
          await this.recordClosed(off.id);
          // The book is final only AFTER close_offering stops on-chain submits — re-assert no in-flight bids.
          await this.assertBookFinal(off.id);
          break;
        case 'closed':
          // Already closed on-chain (a prior attempt closed but didn't settle) — the book is final.
          await this.assertBookFinal(off.id);
          break;
        case 'cancelled':
          throw new OfferingSettleContractError(`escrow ${escrowAddr} is cancelled — cannot settle`, null);
        case 'unknown':
          throw new OfferingEscrowThrottledError(`escrow ${escrowAddr} status unreadable — retry`);
        default:
          assertNever(status);
      }

      // ── Compute the clearing (both paths) ──
      // FROZEN-BOOK DEPENDENCY (TOV-160 #328): this recompute is authoritative ONLY because the escrowed set
      // cannot change once the offering is `subscribed` — both bid submit and cancel require the offering to
      // be `opened` (assertBiddable / assertCancelable), so no bid can enter/leave `escrowed` here, and
      // `computeClearing` is deterministic. On the ADOPT path (already `Settled` on-chain) that means the
      // recompute equals what actually settled. If a future FR ever mutates the escrowed set while
      // `subscribed` (admin bid removal, cancel-during-settle), this would silently diverge the DB receipts
      // from on-chain money — at which point the adopt path MUST reconstruct P/allocations from the on-chain
      // `OfferingSettled` event + `bid()` reads and diff them (the real-adapter merge gate F7/R1), not
      // recompute from the DB. Until then this dependency is the load-bearing invariant.
      const bids = await this.bids.listBidsForClearing(off.id);
      const publicFloat = BigInt(off.publicFloat);
      const result = computeClearing(bids.map(toClearingInput), publicFloat);
      assertClearingInvariants(
        result,
        { lowPriceStroops: off.lowPriceStroops, highPriceStroops: off.highPriceStroops },
        publicFloat,
        bids.length,
        this.cfg.maxBidsPerOffering,
      );

      let txHash: string | null = null;
      let ledger: number | null = null;
      if (!adopted) {
        const settleRes = await this.escrow.closeAndSettle({
          offeringId: off.id,
          escrowAddress: escrowAddr,
          clearingPrice: BigInt(result.clearingPriceStroops),
          allocations: result.winners.map((w) => ({
            bidId: w.chainBidId,
            allocated: BigInt(w.allocatedCount),
          })),
        });
        if (settleRes.alreadySettled) {
          adopted = true;
        } else {
          txHash = settleRes.txHash;
          ledger = settleRes.ledger;
        }
      }

      await this.persist(off, result, bids.length, { txHash, ledger, adopted });
    } catch (err) {
      // Only DETERMINISTIC failures stamp a terminal `settle_failed` (which excludes the row from the
      // stale-subscribed auto-reconcile). Anything else — an unknown/transient error such as a QueryFailedError
      // (deadlock/connection reset) from a repo read or persist() AFTER close_and_settle may have landed — is
      // treated as RETRYABLE: re-throw so BullMQ backs off and the next attempt's self-heal readStatus adopts,
      // instead of spuriously wedging a settleable offering (TOV-160 #321).
      if (!isTerminalSettleError(err)) {
        this.logger.warn(`offering settle transient failure [offering=${off.id}]: ${String(err)}`);
        throw err;
      }
      await this.fail(off.id, sanitizeReason(err));
      throw new UnrecoverableError(`offering settle failed [offering=${off.id}]: ${String(err)}`);
    }
  }

  /**
   * Record the on-chain `close_offering` (OFFERING_CLOSED audit) BEST-EFFORT (TOV-160 #320). This runs AFTER
   * close_offering already landed on-chain, outside the persist txn; a transient audit-write failure must not
   * bubble to the terminal-classification catch (which would stamp `settle_failed` and exclude the row from
   * the stale-subscribed auto-reconcile). The close itself is durable on-chain and re-observed by the next
   * attempt's self-heal readStatus, so a missed audit row is a cosmetic timeline gap, never a wedge.
   */
  private async recordClosed(offeringId: string): Promise<void> {
    await this.audit
      .record({
        actorType: 'system',
        kind: AUDIT_KIND.OFFERING_CLOSED,
        subjectType: 'offering',
        subjectId: offeringId,
        payload: {},
      })
      .catch((err) => this.logger.warn(`OFFERING_CLOSED audit failed [offering=${offeringId}]: ${String(err)}`));
  }

  /** Re-assert the book is final (no in-flight submitted/canceling bids); else retryable → BullMQ backoff. */
  private async assertBookFinal(offeringId: string): Promise<void> {
    const inflight = await this.bids.countInflight(offeringId);
    if (inflight > 0) {
      throw new OfferingEscrowThrottledError(`${inflight} in-flight bid(s) draining — retry`);
    }
  }

  /** CAS `subscribed → settled` + won/lost bid flip + audit snapshot + settled audit — all in one txn. */
  private async persist(
    off: Offering,
    result: ClearingResult & { clearingPriceStroops: string },
    escrowedCount: number,
    chainResult: { txHash: string | null; ledger: number | null; adopted: boolean },
  ): Promise<void> {
    await this.offerings.runInTransaction(async (m) => {
      const won = await this.offerings.casSettled(m, off.id);
      if (!won) return; // already settled (unreachable at concurrency:1 + self-heal) — never double-write

      // N sequential UPDATEs (one per winner) — acceptable at MAX_BIDS ~tens, run after both on-chain txs
      // with no external I/O in the txn and no concurrent settle (concurrency:1). If MAX_BIDS is ever raised
      // materially, collapse this to a single `UPDATE … FROM (VALUES …)` with an `affected == winners.length`
      // check (mirroring `flipRemainingEscrowedToLost`) — see #338.
      for (const w of result.winners) {
        const flipped = await this.bids.casWon(m, w.id, {
          allocatedCount: w.allocatedCount,
          refundStroops: w.refundStroops,
        });
        if (!flipped) {
          throw new SettleInvariantError(`winner bid ${w.id} was not escrowed at settle — aborting settle txn`);
        }
      }
      const lost = await this.bids.flipRemainingEscrowedToLost(m, off.id);
      if (result.winners.length + lost !== escrowedCount) {
        throw new SettleInvariantError(
          `settle flip mismatch: winners ${result.winners.length} + lost ${lost} != escrowed ${escrowedCount}`,
        );
      }

      // Mint-conservation snapshot (TOV-165). `clearedAllocations` is the INDEPENDENT Σ of winner allocations
      // (never `off.publicFloat`) so `CHK_clearing_alloc_eq_float` is a genuine cross-check. The supply/
      // retention values are copied from the offering's frozen planning snapshot (NOT re-read from the mutable
      // `fraction_contracts`), so both the normal and self-heal ADOPT paths (both reach this single persist)
      // carry them with no cross-domain read and no NULL-guard (the offering columns are NOT NULL). A CHECK
      // firing at insert therefore means genuine corruption → the txn rolls back (fail-closed), never the live
      // path (`assertClearingInvariants` already asserted `Σ == public_float` terminally before any chain call).
      const clearedAllocations = result.winners.reduce((s, w) => s + BigInt(w.allocatedCount), 0n);
      // absorbed_leftover = total_supply − artist − treasury − public_float, which is provably 0 today because
      // CHK_off_public_float_decomposition guarantees public_float == total_supply − artist − treasury on every
      // offering row (and CHK_clearing_absorbed_zero re-asserts it). Persisted as the literal '0'; FR-04.06 will
      // reintroduce a non-zero leftover_to_artist here (and relax that CHECK).
      const absorbedLeftover = '0';

      await this.clearingAudit.insertSnapshot(m, {
        offeringId: off.id,
        clearingPriceStroops: result.clearingPriceStroops,
        publicFloat: off.publicFloat,
        totalDemand: result.totalDemand,
        proceedsStroops: result.proceedsStroops,
        platformFeeStroops: result.platformFeeStroops,
        artistNetStroops: result.artistNetStroops,
        clearedAllocationsStroops: clearedAllocations.toString(),
        absorbedLeftoverStroops: absorbedLeftover,
        totalSupplyStroops: off.totalSupplyStroops,
        artistRetentionStroops: off.artistRetentionStroops,
        treasuryRetentionStroops: off.treasuryRetentionStroops,
        bidsSnapshot: result.bidsSnapshot,
        allocationMap: toAllocationMap(result),
        settlementTxHash: chainResult.txHash,
        settledLedger: chainResult.ledger,
        adopted: chainResult.adopted,
      });
      await this.audit.record(
        {
          actorType: 'system',
          kind: AUDIT_KIND.OFFERING_SETTLED,
          subjectType: 'offering',
          subjectId: off.id,
          payload: {
            clearingPriceStroops: result.clearingPriceStroops,
            proceedsStroops: result.proceedsStroops,
            platformFeeStroops: result.platformFeeStroops,
            artistNetStroops: result.artistNetStroops,
            winners: result.winners.length,
            adopted: chainResult.adopted,
            txHash: chainResult.txHash,
          },
        },
        m,
      );
    });
  }

  /** Stamp the terminal settle-failure signal (offering stays `subscribed`) + audit, in one txn. */
  private async fail(offeringId: string, reason: string): Promise<void> {
    await this.offerings.runInTransaction(async (m) => {
      // Only audit when the stamp actually landed (row still `subscribed`) — guard on the CAS result so a
      // no-op (e.g. the row already flipped to `settled`) can't write a spurious OFFERING_SETTLE_FAILED
      // against a successful settlement (#330).
      const stamped = await this.offerings.setSettleFailureStamp(m, offeringId, reason);
      if (!stamped) return;
      await this.audit.record(
        {
          actorType: 'system',
          kind: AUDIT_KIND.OFFERING_SETTLE_FAILED,
          subjectType: 'offering',
          subjectId: offeringId,
          payload: { reason },
        },
        m,
      );
    });
  }
}
