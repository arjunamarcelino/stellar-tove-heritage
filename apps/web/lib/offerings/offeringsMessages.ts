import type { OfferingUiCode } from '@/lib/types/api';

// Curated, user-facing copy for every offering/bid outcome (TOV-157). Exactly-covering Record so an
// unmapped/renamed OfferingUiCode fails to compile here — a money flow must never surface a raw backend
// message (which can echo XDR fragments / internal diagnostics). BID_INSUFFICIENT_BALANCE is the generic
// fallback; the panel interpolates the Zod-validated required/available amounts into a richer sentence.
export const OFFERINGS_MESSAGES: Record<OfferingUiCode, string> = {
  // ── Bid validation (fail-fast at prepare) ──
  BID_INSUFFICIENT_BALANCE: 'You don’t have enough USDC to place this bid.',
  BID_BELOW_LOW_PRICE: 'Your price is below the offering’s minimum.',
  BID_ABOVE_HIGH_PRICE: 'Your price is above the offering’s maximum.',
  BID_COUNT_EXCEEDS_FLOAT: 'You’ve asked for more fractions than are available.',
  OFFERING_WINDOW_NOT_OPEN: 'The subscription window hasn’t opened yet.',
  OFFERING_WINDOW_CLOSED: 'The subscription window has closed — no funds were moved.',
  OFFERING_NOT_OPEN: 'This offering is no longer open for bids.',
  BID_ALREADY_ACTIVE: 'You already have an active bid on this offering.',
  BID_CHALLENGE_EXPIRED: 'Your signing window timed out. Please try again.',
  BID_NOT_WHITELISTED: 'Complete verification to bid on this offering.',
  WALLET_NOT_FOUND: 'Enrol a passkey to place a bid.',
  OFFERING_NOT_FOUND: 'This offering could not be found.',
  // ── Idempotency (retry orchestration) ──
  IDEMPOTENCY_KEY_IN_FLIGHT: 'Your bid is already being processed — checking its status…',
  IDEMPOTENCY_KEY_MISMATCH: 'Something changed with your bid. Please try again.',
  // ── Async escrow outcome (poll) ──
  BID_FAILED: 'Your bid couldn’t be placed. No funds were moved — please try again.',
  // ── Passkey ceremony (client) ──
  PASSKEY_CANCELLED: 'The passkey prompt was dismissed or timed out. Tap to try again.',
  PASSKEY_FAILED: 'Signing failed. Please try again.',
  PASSKEY_UNSUPPORTED: 'Bidding needs a passkey-capable device (Face or Touch ID).',
  // ── Transport fallbacks ──
  SESSION_EXPIRED: 'Your session expired. Sign in again to place this bid.',
  RATE_LIMITED: 'Too many attempts — please wait a moment and try again.',
  NETWORK_ERROR: 'We couldn’t reach the server. Check your connection and try again.',
  SERVER_ERROR: 'Something went wrong on our end. Please try again.',
};
