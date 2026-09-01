import type { OfferingStatus, OfferingUiState } from '@/lib/types/api';

// The bid-capability verdict for a viewer, as a pure machine-readable value rather than an inline JSX ladder
// (todo 149). Covers the SSR-derivable arms (active bid / non-biddable status / anon / not-whitelisted /
// biddable); the passkey-support arms (`no-passkey`/`unsupported`) stay client-side in BidPanel since they
// need a device probe. Precedence matches OfferingPage's original ladder: an active bid wins over everything.
export type BidGate =
  | { kind: 'active-bid' } // has an active bid → ActiveBidCard
  | { kind: 'status' } // not biddable → StatusMessage (the uiState carries the reason)
  | { kind: 'gate'; reason: 'anon' | 'not-whitelisted' } // sign in / complete KYC
  | { kind: 'bid' }; // whitelisted + biddable → BidPanel (which then checks passkey support)

export function bidGateVerdict(
  uiState: OfferingUiState,
  viewer: { hasActiveBid: boolean; isSignedIn: boolean; isWhitelisted: boolean },
): BidGate {
  if (viewer.hasActiveBid) return { kind: 'active-bid' };
  if (uiState !== 'biddable') return { kind: 'status' };
  if (!viewer.isSignedIn) return { kind: 'gate', reason: 'anon' };
  if (!viewer.isWhitelisted) return { kind: 'gate', reason: 'not-whitelisted' };
  return { kind: 'bid' };
}

// Collapse the six-member offering lifecycle into the four UI states the OfferingPage gates on (TOV-157).
// Computed SSR from the raw `status` plus the injected `nowMs` (never the wall clock — SSR and the client
// must agree). `opened` is the only status whose verdict depends on the window: it's `coming-soon` before
// the open instant, `biddable` inside [open, close), and `closed` at/after close. Boundaries: open is
// INCLUSIVE (`>=` open) and close is EXCLUSIVE (`>=` close ⇒ closed) — the backend's prepare-time verdict
// is authoritative; this is only the display gate. The exhaustiveness guard makes a new OfferingStatus a
// compile error until it's mapped here.
export function offeringUiState(
  status: OfferingStatus,
  nowMs: number,
  windowOpenAt: string,
  windowCloseAt: string,
): OfferingUiState {
  switch (status) {
    case 'planned':
    case 'approved':
      return 'coming-soon';
    case 'opened': {
      const openMs = new Date(windowOpenAt).getTime();
      const closeMs = new Date(windowCloseAt).getTime();
      if (nowMs < openMs) return 'coming-soon';
      if (nowMs < closeMs) return 'biddable';
      return 'closed';
    }
    case 'subscribed':
    case 'settled':
      return 'closed';
    case 'canceled':
      return 'canceled';
    default: {
      // Exhaustiveness guard: a new OfferingStatus member must be handled above (compile error).
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
