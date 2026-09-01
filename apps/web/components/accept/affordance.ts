import type { TradeFailureReason } from '@/lib/types/api';

// Error-code routing for the accept ceremony lives in the hook, not a table (todo 178): the codes that warrant a
// tailored affordance are routed to dedicated useAcceptFlow states (staleQuote / notWhitelisted / insufficientUsdc
// / sessionExpired), and the generic `error` state's retry-ability is the hook's `retry` disposition. Only the
// TERMINAL settlement routing (below) needs a table, because it's keyed on the closed failureReason set.

// How the terminal `failed` settlement routes, by the (permissive) failureReason. seller-fault → the quote is
// consumed/expired, so offer a DIFFERENT quote; buyer/ambiguous → the quote stays open, so RE-ACCEPT (a fresh
// prepare); the rest are plain alerts. `unknown` falls back to the safe re-accept path.
export type TerminalAffordance =
  | { kind: 'accept-another' } // seller-fault — quote expired, pick another
  | { kind: 're-accept' } // buyer/ambiguous — quote stays open, try again
  | { kind: 'alert' }; // terminal, no recovery here

const FAILURE_AFFORDANCE: Record<TradeFailureReason, TerminalAffordance> = {
  seller_balance_insufficient: { kind: 'accept-another' },
  seller_lockup: { kind: 'accept-another' },
  seller_auth_lapsed: { kind: 'accept-another' },
  buyer_signature_expired: { kind: 're-accept' },
  buyer_not_whitelisted: { kind: 're-accept' },
  buyer_usdc_insufficient: { kind: 're-accept' }, // add funds + accept again (copy says how)
  party_frozen: { kind: 're-accept' },
  signature_invalid: { kind: 're-accept' },
  settlement_reverted: { kind: 're-accept' },
  settle_abandoned: { kind: 're-accept' },
  invalid_trade: { kind: 'alert' },
  token_not_found: { kind: 'alert' },
  unknown: { kind: 're-accept' },
};

export function failureAffordance(reason: TradeFailureReason | null): TerminalAffordance {
  // A `failed` trade with no reason is ambiguous → the safe re-accept path.
  return reason ? FAILURE_AFFORDANCE[reason] : { kind: 're-accept' };
}
