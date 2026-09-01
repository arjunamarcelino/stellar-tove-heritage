import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { AUDIT_KIND } from '@modules/wallets/audit/audit-log.types';
import { RELAYER_SERVICE, IRelayerService } from '@modules/relayer/relayer.service.interface';
import { RelayerTransferError } from '@modules/relayer/relayer.errors';
import {
  OFFERING_BID_REPOSITORY,
  IOfferingBidRepository,
} from '../../repositories/offering-bid-repository.interface';
import { OFFERING_BID_CANCEL_QUEUE } from '../offering-bids.constants';
import { OfferingBidCancelJob } from '../offering-bid-cancel.job';

/**
 * Async cancel/refund worker (TOV-158): relays the passkey-signed `cancel_bid` so the escrow contract refunds
 * the bid's escrowed USDC to the bidder. `concurrency: 1` — shares the SAME `relayer:account` send-lock as the
 * escrow worker (one keypair, ~1 tx/ledger — a joint SLO; cross-worker lock contention is expected, see R6).
 * Reload + no-op guard (status ≠ `canceling`) makes a duplicate/re-driven job harmless.
 *
 * MONEY-SAFETY (the INVERSION of the escrow worker): the row is `canceling` and the funds are STILL escrowed,
 * so the safe outcomes are the opposite of submit's:
 *  - refund landed (poll SUCCESS)              → CAS `canceling → canceled` (+ stamp refund hash), frees the slot;
 *  - provably NO refund moved                  → CAS `canceling → escrowed` (slot held), stop retrying;
 *  - ambiguous / lost-confirmation             → rethrow (BullMQ backoff), row STAYS `canceling`.
 * Reverting to `escrowed` after a refund actually landed would let the collector re-cancel → DOUBLE REFUND, so
 * ambiguity must NEVER revert. There is intentionally NO reconciler: the enqueue retry budget outlasts the
 * signature validity window, so a persistently-ambiguous cancel eventually re-submits with an expired signature
 * → `expired` (provably-no-refund) → self-heals to `escrowed`, freeing the collector to re-cancel.
 */
@Processor(OFFERING_BID_CANCEL_QUEUE, {
  concurrency: 1,
  lockDuration: 90_000,
  stalledInterval: 30_000,
  maxStalledCount: 1,
})
export class OfferingBidCancelProcessor extends WorkerHost {
  private readonly logger = new Logger(OfferingBidCancelProcessor.name);

  constructor(
    @Inject(OFFERING_BID_REPOSITORY) private readonly bids: IOfferingBidRepository,
    @Inject(RELAYER_SERVICE) private readonly relayer: IRelayerService,
    private readonly audit: AuditLogService,
  ) {
    super();
  }

  async process(job: Job<OfferingBidCancelJob>): Promise<void> {
    const d = job.data;
    const bid = await this.bids.findOneById(d.bidId);
    if (!bid || bid.status !== 'canceling') {
      return; // no-op: already resolved / concurrently latched (duplicate or re-driven job)
    }

    let result: Awaited<ReturnType<IRelayerService['submitSignedCancelBid']>>;
    try {
      result = await this.relayer.submitSignedCancelBid({
        txXdr: d.txXdr,
        caller: d.walletContract,
        escrowContract: d.escrowContract,
        chainBidId: d.chainBidId,
        boundPublicKey: Buffer.from(d.boundPublicKey, 'base64url'),
        credentialId: d.credentialId,
        authenticatorData: Buffer.from(d.authenticatorData, 'base64url'),
        clientDataJSON: Buffer.from(d.clientDataJSON, 'base64url'),
        signature: Buffer.from(d.signature, 'base64url'),
        rpId: d.rpId,
        allowedOrigins: [...d.allowedOrigins],
      });
    } catch (err) {
      // MONEY-SAFETY: revert `canceling → escrowed` ONLY when the refund provably did NOT move — the funds are
      // still escrowed, so this simply re-holds the slot and lets the collector re-cancel. Any post-send
      // ambiguity (RPC timeout as a plain `Error`, or `unavailable`) must NOT revert — a refund that actually
      // landed would then be re-cancelable → DOUBLE REFUND — so it rethrows and the row stays `canceling`.
      if (this.isProvablyRefundNotSent(err, job.attemptsMade === 0)) {
        await this.bids.runInTransaction(async (manager) => {
          const won = await this.bids.casCancelFailedBackToEscrowed(manager, bid.id);
          if (!won) return;
          await this.audit.record(
            {
              actorType: 'system',
              kind: AUDIT_KIND.BID_CANCEL_FAILED,
              subjectType: 'offering_bid',
              subjectId: bid.id,
              payload: { reason: this.sanitize(err) },
            },
            manager,
          );
        });
        throw new UnrecoverableError(`offering bid cancel failed [bid=${bid.id}]: ${this.sanitize(err)}`);
      }
      // Retryable / ambiguous (never revert) → rethrow; BullMQ backs off, the row stays `canceling`.
      throw err;
    }

    const refundTxHash = result.txHash.toLowerCase();
    await this.bids.runInTransaction(async (manager) => {
      const won = await this.bids.casCanceled(manager, bid.id, { refundTxHash });
      if (!won) return; // a duplicate / re-driven job already latched
      await this.audit.record(
        {
          actorType: 'system',
          kind: AUDIT_KIND.BID_CANCELED,
          subjectType: 'offering_bid',
          subjectId: bid.id,
          payload: { refundTxHash, ledger: result.ledger },
        },
        manager,
      );
    });
  }

  /**
   * True only when the refund provably did NOT move on-chain, so it is safe to revert `canceling → escrowed`.
   * Fail-closed: anything unknown (a plain `Error` — e.g. an RPC timeout after send, or a poll timeout thrown
   * as `unavailable`) is NOT provable → the row stays `canceling` (never re-cancelable → no double refund).
   * The reason allowlist mirrors the escrow worker's `isProvablyNoFundsMoved` verbatim; only the CAS target
   * differs. NB: this is NOT compile-exhaustive (fail-closed `default: false`) — keep it in sync by hand with
   * the compile-exhaustive `OfferingBidsService.mapCancelRelayerError`.
   */
  private isProvablyRefundNotSent(err: unknown, firstAttempt: boolean): boolean {
    if (!(err instanceof RelayerTransferError)) {
      return false;
    }
    switch (err.reason) {
      case 'signature_required':
      case 'signature_invalid':
      case 'expired':
      case 'transfer_failed':
        return true;
      case 'simulation_failed':
        return firstAttempt;
      case 'unavailable':
      default:
        return false;
    }
  }

  /** Bounded, single-line reason for the audit payload — never the raw SDK error or any assertion bytes. */
  private sanitize(err: unknown): string {
    const reason = err instanceof RelayerTransferError ? err.reason : 'unknown';
    return reason.slice(0, 200);
  }
}
