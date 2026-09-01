import type { QuoteErrorCode } from '@/lib/types/api';

// Curated, user-facing copy for every quote-submission outcome (TOV-176 / FR-06.03). Exactly-covering Record so
// an unmapped/renamed QuoteErrorCode fails to compile here — a money-adjacent flow must never surface a raw
// backend message (which can echo internal diagnostics). The insufficient-balance numbers (requiredFractionCount
// / freeFractionCount) and the validUntil-capped notice are interpolated in the components, not here (mirrors
// rfqMessages.ts). SELL-side language ("you're offering", "you'd receive") — never buy-side "you pay".
//
// server-only-FREE by design: both the 'use client' hook (useSubmitQuote) and the server-only service import
// this, so it must never `import 'server-only'`.
export const QUOTE_MESSAGES: Record<QuoteErrorCode, string> = {
  // ── Validation / eligibility ──
  VALIDATION_FAILED: 'Please check the quote details and try again.',
  QUOTE_NOT_WHITELISTED: 'Complete KYC to submit a quote.',
  QUOTE_RFQ_NOT_FOUND: 'This request for quotes could not be found.',
  QUOTE_RFQ_NOT_OPEN: 'This request for quotes isn’t accepting quotes right now.',
  QUOTE_RFQ_EXPIRED: 'This request for quotes has expired and can no longer receive quotes.',
  QUOTE_ON_OWN_RFQ: 'You can’t submit a quote on your own request.',
  QUOTE_INVALID_PRICE: 'Enter a price above 0.',
  QUOTE_AMOUNT_OVERFLOW: 'That price × quantity is too large. Lower the price or quantity.',
  QUOTE_INVALID_VALIDITY: 'Choose a validity window in the future.',
  QUOTE_NO_SETTLEMENT_WALLET:
    'Set up a settlement wallet before quoting, so a filled quote can settle.',
  QUOTE_INSUFFICIENT_FREE_BALANCE: 'You don’t have enough free fractions for this quote.',
  // ── Conflict (dead-end — no cancel endpoint yet; reassuring, implies the prior submit succeeded) ──
  QUOTE_ALREADY_OPEN:
    'You already have an open quote on this request. It stays active until it expires or the request closes — you can submit a new one after that.',
  // ── Idempotency (advisory — rendered in a polite live region, not an alert) ──
  IDEMPOTENCY_KEY_IN_FLIGHT:
    'Still processing — we’re confirming the quote you already sent, not creating a new one. Try again in a moment.',
  IDEMPOTENCY_KEY_MISMATCH: 'Something changed — please review and resubmit.',
  // ── Transport / transient ──
  QUOTE_BALANCE_UNAVAILABLE: 'We couldn’t check your fraction balance just now. Please try again.',
  SESSION_EXPIRED: 'Your session expired. Sign in again to submit this quote.',
  RATE_LIMITED: 'Too many attempts. Wait a moment and try again.',
  NETWORK_ERROR: 'We couldn’t reach the server. Check your connection and try again.',
  SERVER_ERROR: 'Something went wrong on our end. Please try again.',
};
