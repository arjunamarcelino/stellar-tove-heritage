import type { RotationItemStatus } from '@/lib/types/api';

// Pure settlement-outcome classifier for non-atomic, N-item money transfers (TOV-48). Extracted so the
// "did assets move?" decision is derived from the FULL reconciled item set at every stop point — never
// inline in the batched loop — and can't fork by copy-paste. Client-safe, framework-free, no side
// effects. Consumed by BOTH the wallet-rotation and wallet-export (ExportItemStatus is the identical
// union) reconcile loops. See docs/plans/2026-08-27-feat-wallet-rotation-flow-plan.md (data-integrity H4).

export type SettlementOutcome = 'inflight' | 'complete' | 'partial' | 'failed';

// Rules (money-safe by construction):
//  - any pending/submitted item → 'inflight' (keep polling; NEVER claim a terminal outcome yet)
//  - all confirmed → 'complete'
//  - some confirmed + rest terminally failed → 'partial' (assets DID move — never "nothing moved")
//  - zero confirmed + all failed → 'failed' (nothing moved)
//  - empty set → 'inflight' (nothing to conclude yet)
export function deriveSettlementOutcome(
  items: ReadonlyArray<{ status: RotationItemStatus }>,
): SettlementOutcome {
  if (items.length === 0) return 'inflight';

  const anyInFlight = items.some((i) => i.status === 'pending' || i.status === 'submitted');
  if (anyInFlight) return 'inflight';

  const anyConfirmed = items.some((i) => i.status === 'confirmed');
  const allConfirmed = items.every((i) => i.status === 'confirmed');

  if (allConfirmed) return 'complete';
  if (anyConfirmed) return 'partial';
  return 'failed';
}

// Monotonic confirmed count over the full item set — the numerator for "X of N moved".
export function countConfirmed(items: ReadonlyArray<{ status: RotationItemStatus }>): number {
  return items.reduce((n, i) => (i.status === 'confirmed' ? n + 1 : n), 0);
}
