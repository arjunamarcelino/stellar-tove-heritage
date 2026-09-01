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
import { OFFERING_BID_ESCROW_QUEUE } from '../offering-bids.constants';
import { OfferingBidEscrowJob } from '../offering-bid-escrow.job';

/**
 * Async escrow worker (TOV-156): relays the passkey-signed `submit_bid` to move `price × count` USDC into
 * the offering's escrow. `concurrency: 1` — all bids serialize on the shared relayer source account
 * (learnings #4). Reload + no-op guard makes a duplicate/re-driven job harmless. Success CAS-latches
 * `submitted → escrowed` (stamping the contract bid id + tx hash); a retryable relayer error rethrows for
 * BullMQ backoff (row stays `submitted`); a terminal error CAS-latches `failed` + audits and stops retrying.
 *
 * NOTE (follow-up, todo 294): a `submitted` bid can strand — the enqueue failed after commit, the process
 * crashed, or (per the money-safe classification above) a lost-confirmation retry left it `submitted`. There
 * is intentionally NO bid reconciler in this feature: the safe resolution is a DB↔chain reconciler that
 * QUERIES chain state (on-chain `DuplicateBid` → adopt-as-escrowed by the emitted bid id) rather than
 * inferring from an error string, and it is deferred until it can be validated on live testnet. Until then a
 * stranded row stays `submitted` (never wrongly failed — no funds lost) and is resolved manually via the
 * stuck-bid monitoring alert (todo 302).
 */
@Processor(OFFERING_BID_ESCROW_QUEUE, {
  concurrency: 1,
  lockDuration: 90_000,
  stalledInterval: 30_000,
  maxStalledCount: 1,
})
export class OfferingBidEscrowProcessor extends WorkerHost {
  private readonly logger = new Logger(OfferingBidEscrowProcessor.name);

  constructor(
    @Inject(OFFERING_BID_REPOSITORY) private readonly bids: IOfferingBidRepository,
    @Inject(RELAYER_SERVICE) private readonly relayer: IRelayerService,
    private readonly audit: AuditLogService,
  ) {
    super();
  }

  async process(job: Job<OfferingBidEscrowJob>): Promise<void> {
    const d = job.data;
    const bid = await this.bids.findOneById(d.bidId);
    if (!bid || bid.status !== 'submitted') {
      return; // no-op: already latched / concurrently resolved (duplicate or re-driven job)
    }

    let result: Awaited<ReturnType<IRelayerService['submitSignedBid']>>;
    try {
      result = await this.relayer.submitSignedBid({
        txXdr: d.txXdr,
        walletContract: d.walletContract,
        escrowContract: d.escrowContract,
        tokenContract: d.tokenContract,
        priceScaled: d.priceScaled,
        count: d.count,
        maxCostScaled: d.maxCostScaled,
        idempotencyKey: Buffer.from(d.idempotencyKey, 'base64url'),
        boundPublicKey: Buffer.from(d.boundPublicKey, 'base64url'),
        credentialId: d.credentialId,
        authenticatorData: Buffer.from(d.authenticatorData, 'base64url'),
        clientDataJSON: Buffer.from(d.clientDataJSON, 'base64url'),
        signature: Buffer.from(d.signature, 'base64url'),
        rpId: d.rpId,
        allowedOrigins: [...d.allowedOrigins],
      });
    } catch (err) {
      // MONEY-SAFETY (todo 293): CAS-`failed` ONLY when the escrow provably moved no funds on-chain —
      // otherwise a bid that actually escrowed would be latched `failed`, which frees the active-per-
      // collector slot and lets the collector bid again → DOUBLE ESCROW. Any post-send ambiguity (an RPC
      // timeout thrown as a plain `Error`, or a `DuplicateBid` that surfaces as `simulation_failed` on a
      // RETRY of a bid whose first send already landed) is treated as retryable → rethrow, leaving the row
      // `submitted` for reconcile/manual adoption (the DB↔chain reconciler is a documented follow-up).
      if (this.isProvablyNoFundsMoved(err, job.attemptsMade === 0)) {
        await this.bids.runInTransaction(async (manager) => {
          const won = await this.bids.casFailed(manager, bid.id);
          if (!won) return;
          await this.audit.record(
            {
              actorType: 'system',
              kind: AUDIT_KIND.BID_ESCROW_FAILED,
              subjectType: 'offering_bid',
              subjectId: bid.id,
              payload: { reason: this.sanitize(err) },
            },
            manager,
          );
        });
        throw new UnrecoverableError(`offering bid escrow failed [bid=${bid.id}]: ${this.sanitize(err)}`);
      }
      // Retryable / ambiguous (never free the slot) → rethrow; BullMQ backs off, the row stays `submitted`.
      throw err;
    }

    const txHash = result.txHash.toLowerCase();
    await this.bids.runInTransaction(async (manager) => {
      const won = await this.bids.casEscrowed(manager, bid.id, { chainBidId: result.bidId, txHash });
      if (!won) return; // a reconcile / duplicate job already latched
      await this.audit.record(
        {
          actorType: 'system',
          kind: AUDIT_KIND.BID_ESCROWED,
          subjectType: 'offering_bid',
          subjectId: bid.id,
          payload: { chainBidId: result.bidId, txHash, ledger: result.ledger },
        },
        manager,
      );
    });
  }

  /**
   * True only when the escrow attempt provably moved NO USDC on-chain, so it is safe to CAS-`failed`
   * (which frees the active-bid slot). Fail-closed: anything unknown (a plain `Error` — e.g. an RPC
   * timeout after `sendTransaction` was accepted) is NOT provable → retryable, never terminal.
   *
   * - `signature_required|signature_invalid|expired`: pre-send verification/expiry — nothing was sent.
   * - `transfer_failed`: the tx was sent but rejected-on-send or applied-and-reverted — no state change.
   * - `simulation_failed`: safe ONLY on the first attempt (pre-send re-simulation). On a RETRY it may be
   *   the on-chain `DuplicateBid` (the first attempt's send actually landed), so it is NOT provable.
   * - `unavailable` / any non-`RelayerTransferError`: ambiguous → retryable.
   */
  private isProvablyNoFundsMoved(err: unknown, firstAttempt: boolean): boolean {
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
