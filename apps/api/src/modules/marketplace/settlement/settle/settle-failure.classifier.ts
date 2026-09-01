import type { AcceptQuoteOutcome } from '@modules/relayer/relayer.service.interface';
import type { SettleFailureReason, QuoteDisposition } from './settle-failure.constant';

/**
 * Map a NON-success `AcceptQuoteOutcome` to a settlement classification (TOV-177). `terminal:false` ⇒ retry
 * (the worker re-attempts / re-reads is_settled). `terminal:true` ⇒ fail the trade with `reason` and dispose
 * the quote (`expire` for seller-fault; `keepOpen` for buyer/ambiguous so the buyer can re-accept). FAIL-CLOSED:
 * an unknown code/reason is RETRYABLE (never a spurious terminal-fail). The caller re-reads `is_settled` before
 * acting on a terminal classification, so a landed-but-ambiguous outcome adopts instead of failing.
 */
export type SettleClassification =
  | { terminal: false }
  | { terminal: true; reason: SettleFailureReason; quoteDisposition: QuoteDisposition };

// FractionToken / OZ contract error codes (see the deployed contracts).
const OZ_INSUFFICIENT_BALANCE = 100; // seller's fraction balance short
const FT_RECIPIENT_NOT_WHITELISTED = 5;
const FT_FROZEN = 6;
const FT_ARTIST_LOCKUP = 7;
const FT_TREASURY_LOCKUP = 8;
const FT_INVALID_TRADE = 10;
const FT_MIGRATION_PENDING = 11;
const SETTLER_TOKEN_NOT_FOUND = 2;

function fail(reason: SettleFailureReason, quoteDisposition: QuoteDisposition): SettleClassification {
  return { terminal: true, reason, quoteDisposition };
}

export function classifySettleFailure(
  outcome: Extract<AcceptQuoteOutcome, { status: 'REVERTED' | 'RELAYER_FAILED' }>,
): SettleClassification {
  if (outcome.status === 'REVERTED') {
    switch (outcome.contractCode) {
      case OZ_INSUFFICIENT_BALANCE:
        return fail('seller_balance_insufficient', 'expire');
      case FT_ARTIST_LOCKUP:
      case FT_TREASURY_LOCKUP:
        return fail('seller_lockup', 'expire');
      case FT_FROZEN:
        return fail('party_frozen', 'keepOpen'); // ambiguous which party → conservative
      case FT_RECIPIENT_NOT_WHITELISTED:
        return fail('buyer_not_whitelisted', 'keepOpen');
      case FT_INVALID_TRADE:
        return fail('invalid_trade', 'keepOpen'); // should never happen → alert
      case SETTLER_TOKEN_NOT_FOUND:
        return fail('token_not_found', 'keepOpen'); // should never happen → alert
      case FT_MIGRATION_PENDING:
        return { terminal: false }; // temporary seal → retry (the sole genuinely-transient on-chain code)
      default:
        // A parsed REVERTED (or a null code) is DETERMINISTIC — retrying can't change a contract revert, and the
        // caller has already confirmed via is_settled that no funds moved. Terminate keepOpen instead of the old
        // retry-forever that stranded the pending latch, and NEVER expire the seller for an unclassified /
        // cross-contract (USDC-SAC vs OZ) code we cannot prove is seller-fault (TOV-177 #383).
        return fail('settlement_reverted', 'keepOpen');
    }
  }
  // RELAYER_FAILED
  switch (outcome.reason) {
    case 'expired':
      // A lapsed SELLER auth expires the quote (the seller must re-authorize); a lapsed BUYER signature keeps
      // it open (the buyer re-prepares). `expiredParty` is set by the relayer's two-entry expiry check (#389).
      return outcome.expiredParty === 'seller'
        ? fail('seller_auth_lapsed', 'expire')
        : fail('buyer_signature_expired', 'keepOpen');
    case 'signature_required':
    case 'signature_invalid':
      return fail('signature_invalid', 'keepOpen');
    case 'transfer_failed':
    case 'simulation_failed':
      return fail('settlement_reverted', 'keepOpen'); // applied+reverted / pre-send reject → no funds moved
    case 'unavailable':
    default:
      return { terminal: false }; // transient → retry
  }
}
