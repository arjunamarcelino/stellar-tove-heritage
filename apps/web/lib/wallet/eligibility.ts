import type { WalletSummary } from '@/lib/types/api';

// Pure eligibility predicates over a WalletSummary, shared by the UI (WalletRow gates the buttons)
// and reusable by any non-UI caller. They are a client-side convenience only — the backend is
// authoritative and independently rejects ineligible targets (set-primary: active embedded → 422,
// exported → 409; remove: primary → 409, embedded → 422). A programmatic caller can pre-filter with
// these, but must still handle the backend backstop codes, and must re-read GET /v1/me/wallets to
// observe post-mutation state (the mutation actions return no wallet payload by design).

// Only a non-primary BYOW wallet can be removed. `undefined`/unknown isPrimary ⇒ not removable
// (conservative — a stale/lagging backend never exposes Remove on a wallet that might be primary).
// Embedded wallets offboard via export.
export function isRemovable(w: WalletSummary): boolean {
  return w.kind === 'byow' && w.isPrimary === false;
}

// Only a non-primary, non-exported BYOW can be promoted to primary (matches the backend contract:
// active embedded → 422, exported → 409). `undefined` isPrimary ⇒ not eligible (conservative). The
// `!exported` clause is load-bearing if branch order ever changes, so keep it in the guard even
// though the row checks `exported` first.
export function canSetPrimary(w: WalletSummary): boolean {
  return w.kind === 'byow' && w.isPrimary === false && w.exported === false;
}
