// Quote submission tuning constants (TOV-176 / FR-06.03). Kept out of quoteMessages.ts so that file stays
// copy-only (mirrors the lib/rfq constants/messages split). The feature-neutral money primitives
// (STROOPS_PER_USDC, I128_MAX, U96_MAX, USDC_DECIMALS) and format helpers live in lib/money/.

// Submit-quote POST timeout — sized generously for the backend's LIVE on-chain fraction-balance read (the gate
// can take a few seconds on the happy path), unlike the RFQ create's pure DB write (RFQ_TIMEOUT_MS = 10s).
export const QUOTE_TIMEOUT_MS = 20_000;

// The validity-window presets shown in the dropdown. The form resolves the chosen preset to an ISO-8601 `…Z`
// instant AT submit (`new Date(Date.now() + hours*3600_000).toISOString()`) and freezes it into the request
// body. All presets are >= 24h so a transient same-key retry (seconds) can never make the frozen instant stale
// (the C1 retry-safety margin). `Z` is an explicit offset, so presets satisfy the tz requirement for free.
export const VALIDITY_PRESETS = [24, 48, 72, 168] as const; // hours
export type ValidityHours = (typeof VALIDITY_PRESETS)[number]; // 24 | 48 | 72 | 168
export const DEFAULT_VALIDITY_HOURS: ValidityHours = 48;
