import type { QuoteGateReason } from '@/lib/types/api';

// The quote-submission capability verdict for a viewer, as a pure machine-readable value (mirrors
// rfqGateVerdict). DELIBERATELY INDEPENDENT of any offering window — a quote is a secondary-market sell
// response, keyed only by the RFQ. Precedence: anon → load-error → not-whitelisted → submit.
export type QuoteGate =
  | { kind: 'gate'; reason: QuoteGateReason } // sign in / complete KYC
  | { kind: 'load-error' } // the whitelist read itself failed (5xx/timeout) → neutral retry, NOT the KYC gate
  | { kind: 'submit' }; // signed-in + whitelisted → the quote form

export function quoteGateVerdict(viewer: {
  // `isSignedIn` means "has a NON-STALE token" — the host computes it as `token != null && !sessionStale`, so a
  // stale token degrades to the anon (sign-in) CTA.
  isSignedIn: boolean;
  isWhitelisted: boolean;
  // The whitelist read returned a non-session error (5xx / timeout). Ordered ABOVE the not-whitelisted gate so a
  // read failure never masquerades as "complete KYC" — telling a whitelisted holder to redo KYC would be
  // actively misleading (C7). A session error is folded into `isSignedIn` upstream, so it surfaces as anon.
  readFailed?: boolean;
}): QuoteGate {
  if (!viewer.isSignedIn) return { kind: 'gate', reason: 'anon' };
  if (viewer.readFailed) return { kind: 'load-error' };
  if (!viewer.isWhitelisted) return { kind: 'gate', reason: 'not-whitelisted' };
  return { kind: 'submit' };
}
