// Offering subscription tuning constants (TOV-157 / FR-05.03). Kept out of offeringsMessages.ts so that file
// stays copy-only (mirrors the lib/holdings + lib/kyc constants/messages split).

// Read/prepare/submit timeout — parity with HOLDINGS_TIMEOUT_MS / KYC_STATUS_TIMEOUT_MS.
export const OFFERING_TIMEOUT_MS = 10_000;

// How long the public offering read is shared in Next's fetch cache. The countdown is computed client-side
// from the absolute window timestamps, so caching the body never staleness the clock — only `status`
// transitions lag by this window (the prepare-time server verdict backstops it).
export const OFFERING_REVALIDATE_S = 20;

// Bid escrow poll (useMyBidPolling). Base 3s aligns with Stellar's ~5s ledger cadence (a fixed 2s loop mostly
// re-reads an unchanged `submitted`); ±15% jitter de-syncs bidders who submit near windowCloseAt; exponential
// backoff on 429/5xx so a RATE_LIMITED isn't re-hit at cadence; the cap is measured by ACTIVE (pause-excluded)
// time so a backgrounded tab doesn't burn the budget.
export const BID_POLL_INTERVAL_MS = 3_000;
export const BID_POLL_JITTER_RATIO = 0.15;
export const BID_POLL_BACKOFF_MAX_MS = 24_000;
export const BID_POLL_CAP_MS = 60_000;
export const BID_POLL_MAX_FAILURES = 5; // consecutive transport failures before the poll stops (phase 'error')

// Price controls. The slider steps in whole-USDC increments for ergonomics, but the numeric USDC input is
// authoritative and sub-USDC prices are valid (any integer stroop within the band).
export const SLIDER_STEP_STROOPS = 10_000_000; // 1 USDC

// Feature-neutral money constants (STROOPS_PER_USDC, USDC_DECIMALS, I128_MAX, U96_MAX) were promoted to
// lib/money/constants.ts (TOV-173). Re-exported here so existing offering imports keep their path unchanged.
export { STROOPS_PER_USDC, USDC_DECIMALS, I128_MAX, U96_MAX } from '@/lib/money/constants';
