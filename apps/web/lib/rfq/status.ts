import type { RfqGateReason } from '@/lib/types/api';

// The RFQ create-capability verdict for a viewer, as a pure machine-readable value (mirrors bidGateVerdict).
// DELIBERATELY INDEPENDENT of the offering subscription window: an RFQ is secondary-market buy-intent, unrelated
// to the primary sale's open/closed lifecycle, so it renders for any signed-in whitelisted Collector regardless
// of offering uiState. Precedence: anon → not-whitelisted → not-fractionalized → create.
export type RfqGate =
  | { kind: 'gate'; reason: RfqGateReason } // sign in / complete KYC
  | { kind: 'unavailable' } // artwork not fractionalized (only when the flag is known false)
  | { kind: 'create' }; // whitelisted + eligible → the "Make an offer" CTA/form

export function rfqGateVerdict(viewer: {
  // `isSignedIn` means "has a NON-STALE token" — the host computes it as `token != null && !sessionStale`, so a
  // stale token degrades to the anon (sign-in) CTA.
  isSignedIn: boolean;
  isWhitelisted: boolean;
  // `undefined` = the page can't tell (no flag on the payload yet) → render-and-error on submit (default). Only
  // an explicit `false` proactively hides the CTA (no new read is issued to learn this).
  fractionalized?: boolean;
}): RfqGate {
  if (!viewer.isSignedIn) return { kind: 'gate', reason: 'anon' };
  if (!viewer.isWhitelisted) return { kind: 'gate', reason: 'not-whitelisted' };
  if (viewer.fractionalized === false) return { kind: 'unavailable' };
  return { kind: 'create' };
}
