import type { HoldingsTransportErrorCode } from '@/lib/types/api';

// Curated transport-error copy for the holdings widget — never a raw backend string. Exactly-covering
// Record so an unmapped/renamed code fails to compile.
export const HOLDINGS_MESSAGES: Record<HoldingsTransportErrorCode, string> = {
  SESSION_EXPIRED: 'Your session expired. Please sign in again.',
  NETWORK_ERROR: 'Couldn’t reach the server. Check your connection and try again.',
  SERVER_ERROR: 'We couldn’t load your fractions. Please try again.',
};
