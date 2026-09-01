// Holdings read timeout — parity with KYC_STATUS_TIMEOUT_MS. Kept out of messages.ts so that file is
// copy-only (mirrors the lib/kyc constants/messages split).
export const HOLDINGS_TIMEOUT_MS = 10_000;
