// RFQ create tuning constants (TOV-173 / FR-06.01). Kept out of rfqMessages.ts so that file stays copy-only
// (mirrors the lib/offerings constants/messages split). The feature-neutral money primitives (STROOPS_PER_USDC,
// I128_MAX, U96_MAX, USDC_DECIMALS) and format helpers live in lib/money/ (promoted from lib/offerings).

// Create-RFQ POST timeout — parity with OFFERING_TIMEOUT_MS.
export const RFQ_TIMEOUT_MS = 10_000;

// The expiry_hours presets shown in the dropdown. Omitting expiry_hours defaults to 48h server-side, but the
// client always sends an explicit value (canonical body → unambiguous idempotency comparison).
export const EXPIRY_PRESETS = [24, 48, 72, 168] as const; // hours
export const DEFAULT_EXPIRY_HOURS = 48 as const;
