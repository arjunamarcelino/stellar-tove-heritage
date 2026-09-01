---
status: complete
priority: p2
issue_id: 430
tags: [code-review, tov-33, pr-56, data-integrity, error-handling]
dependencies: []
---
# `finalizeIfAllConfirmed` else-branch can demote a completed rotation → CHECK violation → unhandled 500

## Resolution (2026-08-27) — Solution 1 (guard the demotion)
- **`wallet-rotation.repository.ts` `finalizeIfAllConfirmed`**: the else-branch demotion is now
  `update({ id, status: Not('completed') }, { status: 'submitting' })` — a no-op (0 rows) on a terminal row, so a
  re-submit whose live re-read threw can no longer drive `completed → submitting` and trip `CHK_wrt_completed_at`.
- **Test**: integration spec completes a rotation, then re-finalizes with `allBalancesZero=false` → returns false,
  no CHECK violation, row stays `completed`. Rotation integration 8/8, build 0.

## Problem Statement
A re-`submit` on an already-`completed` rotation can drive `finalizeIfAllConfirmed` into its else-branch, which
issues `UPDATE … SET status='submitting'` on a row where `completed_at IS NOT NULL`. That violates
`CHK_wrt_completed_at`, the txn throws, and `submit`'s outer catch passes it through as a **raw 500** (not a mapped
`WalletRotationError`). No data corruption (the CHECK does its job and rolls back), but it's an unhandled 500 on a
money endpoint and a latent trap relying on the CHECK to prevent a status regression.

## Findings
- `submit` loads the rotation via `findOwnedWithItems` with **no status filter** → an already-`completed` rotation
  is returned (`wallet-rotation.service.ts:243`).
- If the FE re-calls `submit` (retry/network) and the final live-balance re-read throws, `allZero` is forced
  `false` (`:349-351`). `finalizeIfAllConfirmed` is then called with `allBalancesZero=false`; inside the txn
  `remaining===0` but `&& allBalancesZero` fails → else-branch `UPDATE … status='submitting'`
  (`wallet-rotation.repository.ts:155`, no status guard) on a completed row → `CHK_wrt_completed_at`
  ((false)=(true)) → throw → `runInTransaction` rethrows → raw 500. (data-integrity-guardian P2)

## Proposed Solutions
1. **Guard the demotion with `AND status <> 'completed'`** in the else-branch `UPDATE` (affected 0 rows on a
   terminal row → no CHECK violation, idempotent). Effort: Small. Recommended.
2. **Short-circuit `finalizeIfAllConfirmed` when the row is already `completed`** (read status under the row lock,
   return `true` early). Effort: Small.
3. **Filter `findOwnedWithItems` to non-terminal rotations for submit** (a completed rotation → treat every item as
   already-confirmed, return `completed` without re-finalizing). Effort: Small–Medium.

## Recommended Action
(blank — triage)

## Acceptance Criteria
- [ ] Re-submitting a completed rotation (incl. when the live re-read throws) returns a clean response, never a 500.
- [ ] Integration test: complete a rotation, force a balance-read failure, re-submit → no `CHK_wrt_completed_at`
      violation.

## Resources
- PR #56; reviewer: data-integrity-guardian.
