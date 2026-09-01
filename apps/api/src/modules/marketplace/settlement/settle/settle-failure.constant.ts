/**
 * The CLOSED set of `secondary_trades.failure_reason` / `rfq_quotes.status_reason` literals (TOV-177) — kept
 * ≤48 chars (the `varchar(48)` columns). Dependency-free leaf. A drift test asserts `max len ≤ 48`.
 */
export const SETTLE_FAILURE_REASONS = [
  'seller_balance_insufficient',
  'seller_lockup',
  'seller_auth_lapsed',
  'party_frozen',
  'buyer_not_whitelisted',
  'buyer_usdc_insufficient',
  'invalid_trade',
  'token_not_found',
  'buyer_signature_expired',
  'signature_invalid',
  'settlement_reverted',
  'settle_abandoned',
] as const;

export type SettleFailureReason = (typeof SETTLE_FAILURE_REASONS)[number];

/** How a failure affects the winning quote: seller-fault expires it; buyer/ambiguous leaves it open. */
export const QUOTE_DISPOSITIONS = ['expire', 'keepOpen'] as const;
export type QuoteDisposition = (typeof QUOTE_DISPOSITIONS)[number];
