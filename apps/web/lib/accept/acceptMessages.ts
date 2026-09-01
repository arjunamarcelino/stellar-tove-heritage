// Curated, buyer-facing copy for the quote-acceptance flow (TOV-178 / FR-06.04). Kept copy-only (tuning
// constants live in lib/accept/constants.ts — mirrors the lib/offerings split). A money flow NEVER surfaces a
// raw backend message / XDR fragment / diagnostic — every error resolves to one of these curated strings.
//
// The Record is keyed on the AcceptUiCode union, so a newly added code fails to compile until it has copy here
// (the same compile-time lever as the passthrough classifier and the affordance table).

import type { AcceptUiCode, TradeFailureReason } from '@/lib/types/api';

export const ACCEPT_MESSAGES: Record<AcceptUiCode, string> = {
  // ── Accept ceremony (prepare/submit) — backend codes (shipped, PR #49) ──
  ACCEPT_NOT_RFQ_BUYER: 'Only the buyer who created this request can accept a quote here.',
  ACCEPT_RFQ_NOT_OPEN: 'This request is no longer open, so quotes can’t be accepted.',
  ACCEPT_QUOTE_NOT_ACCEPTABLE: 'This quote is no longer available to accept.',
  ACCEPT_QUOTE_NOT_AUTHORIZED:
    'This quote isn’t ready yet — the seller still needs to authorize it. Try another quote or check back shortly.',
  ACCEPT_NOT_WHITELISTED: 'Complete identity verification (KYC) to accept a quote.',
  ACCEPT_INSUFFICIENT_USDC:
    'You don’t have enough USDC to accept this quote. Add funds or choose a smaller quote.',
  ACCEPT_CHALLENGE_EXPIRED: 'Your signature timed out. Please review and sign again.',
  TRADE_ALREADY_IN_FLIGHT:
    'A trade is already being settled for this request. We’ll update you when it finishes.',
  TRADE_NOT_FOUND: 'We couldn’t find a trade for this request.',
  ACCEPT_SETTLEMENT_UNAVAILABLE:
    'Settlement is temporarily unavailable. Please try again in a moment.',
  IDEMPOTENCY_KEY_IN_FLIGHT: 'Still processing your previous attempt — please wait a moment.',
  IDEMPOTENCY_KEY_MISMATCH: 'Something changed since your last attempt. Please start over.',

  // ── RFQ-detail read ──
  RFQ_NOT_FOUND: 'We couldn’t find this request, or it isn’t yours.',

  // ── Transport fallbacks ──
  SESSION_EXPIRED: 'Your session has expired. Please sign in again.',
  RATE_LIMITED: 'Too many requests — please try again in a moment.',
  NETWORK_ERROR: 'We couldn’t reach the server. Check your connection and try again.',
  SERVER_ERROR: 'Something went wrong on our end. Please try again.',

  // ── Synthetic client-only passkey state (the only one the accept flow emits) ──
  PASSKEY_FAILED: 'We couldn’t complete the passkey signature. Please try again.',
};

// Buyer-facing copy for a settled-to-`failed` trade, keyed on the (permissive) TradeFailureReason. Seller-fault
// reasons expire the quote ("accept another"); buyer/ambiguous reasons leave it open ("re-accept"); the rest are
// plain alerts. `unknown` is the safe generic default for any value the backend writes outside the known set.
export const FAILURE_REASON_COPY: Record<TradeFailureReason, string> = {
  // Seller-fault → quote expired → accept a different quote
  seller_balance_insufficient:
    'The seller can no longer deliver these fractions. Try accepting a different quote.',
  seller_lockup:
    'The seller’s fractions are locked up and can’t be delivered. Try a different quote.',
  seller_auth_lapsed:
    'The seller’s authorization expired before settlement. Try a different quote.',
  // Buyer/ambiguous → quote stays open → re-accept after resolving
  buyer_signature_expired: 'Your signature expired before settlement. You can accept again.',
  buyer_not_whitelisted:
    'Your account isn’t cleared to settle this trade. Complete verification and try again.',
  buyer_usdc_insufficient:
    'You didn’t have enough USDC to settle this trade. Add funds and accept again.',
  party_frozen: 'This trade couldn’t settle because an account is on hold. You can try again.',
  signature_invalid: 'The signature couldn’t be verified. You can accept again.',
  settlement_reverted: 'Settlement was reverted on-chain. You can try accepting again.',
  settle_abandoned: 'This trade couldn’t be completed in time. You can try accepting again.',
  // Ambiguous / terminal alerts
  invalid_trade: 'This trade is no longer valid.',
  token_not_found: 'We couldn’t locate the artwork token for this trade.',
  // Safe generic default for any unrecognized backend reason.
  unknown: 'The trade didn’t settle. You can try accepting again.',
};
