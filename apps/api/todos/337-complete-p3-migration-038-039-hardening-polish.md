---
status: complete
priority: p3
issue_id: 337
tags: [code-review, database, migration, tov-160]
dependencies: []
---
# Migration 038/039 hardening polish: settle-refund cap coupling, soft-delete on regulatory audit, FN_GUARD_037 down()-body diff to verify

## Problem Statement
Three migration observations for TOV-160. Two are hardening/documentation nits on constraints and the append-only audit trigger; the third is a genuine **conflict between two reviewers** that must be resolved by a whitespace-sensitive diff before deciding whether any change is needed.

## Findings
- **(1) `CHK_bid_settle_refund_cap` MUST TRACK `CHK_bid_escrow_cap`** — migration 038's `CHK_bid_settle_refund_cap` bounds `settle_refund_stroops` ≤ 2^96-1. This is safe **today** only because migration 036's `CHK_bid_escrow_cap` bounds the full escrow (`price·count`) to the same 2^96-1. A **future** migration that raises the escrow cap toward i128 (2^127-1, matching the aggregate caps 038 itself introduces) **without** also raising the settle-refund cap would make `flipRemainingEscrowedToLost` fail `CHK_bid_settle_refund_cap` (SQLSTATE 23514) and **permanently wedge settlement** for a large loser. Add a comment that `CHK_bid_settle_refund_cap` must track `CHK_bid_escrow_cap` (ideally derive both from one shared constant).
- **(2) SOFT-DELETE ON A REGULATORY AUDIT ROW** — `offering_clearing_audit` has a `deleted_at` column and its append-only trigger **permits** soft-delete (a NULL→timestamp transition), while `findByOfferingId` filters `deleted_at IS NULL` and the plain `UNIQUE(offering_id)` still blocks re-settlement. Net: a soft-deleted snapshot yields a settled offering whose regulatory money artifact is irretrievable via the read model, with no way to recreate it. This is practically unreachable (no code calls `softRemove` on this entity), but for a regulatory artifact the trigger should **REJECT** soft-delete too (drop the NULL→ts allowance) so the row is truly immutable. Also note: `src/database/CLAUDE.md` convention wants a partial index `WHERE deleted_at IS NULL`; here the plain `UNIQUE(offering_id)` is used deliberately (it serves the read and enforces one-settlement) — document this intentional omission.
- **(3) CONFLICT TO VERIFY — FN_GUARD_037 down()-body byte-identity** — the migration-safety reviewer flagged that migration 038's `down()` `FN_GUARD_037` const is **NOT** byte-for-byte identical to migration 037's actual `up()` function body (6/8-space indentation in 037's install vs 2/4-space in the 038 const), so `pg_proc.prosrc` won't match after a dev/test up→down cycle. The data-integrity reviewer **independently claimed it IS** byte-for-byte identical. These conflict. **VERIFY** by diffing 037's `up()` function body against 038's `FN_GUARD_037` const whitespace-sensitively. If they differ: re-indent `FN_GUARD_037` to match 037, or soften 038's docstring claim to "semantically identical; whitespace differs." Impact is dev/test-only because `down()` is prod-guarded.

## Proposed Solutions
### Option A — Full hardening
- Description: Add the cap-coupling comment (or shared constant); change the audit trigger to reject soft-delete and document the intentional partial-index omission; resolve the FN_GUARD_037 conflict per the diff result.
- Pros: Removes the latent settlement-wedge footgun, makes the regulatory artifact truly immutable, and reconciles the two reviewers.
- Cons: Trigger change + re-verification effort.
- Effort: Small-Medium
- Risk: Low

### Option B — Verify (3), document (1) and (2)
- Description: Run the diff for (3) and fix/soften accordingly; add comments for (1) and (2) without changing the trigger.
- Pros: Resolves the actual conflict; records the coupling and the soft-delete gap cheaply.
- Cons: Leaves the (unreachable) soft-delete allowance in the trigger.
- Effort: Small
- Risk: Low

## Recommended Action
First **run the whitespace-sensitive diff for (3)** — it is a factual disagreement that must be settled before deciding. Then take Option A for (1) and (2): the cap-coupling comment/shared constant is cheap insurance against a wedge, and tightening the audit trigger to reject soft-delete is proportionate for a regulatory artifact. Document the intentional plain-UNIQUE (no partial index) choice against `src/database/CLAUDE.md`.

## Technical Details
- 2^96-1 = 79228162514264337593543950335; i128 max = 2^127-1. The aggregate caps 038 introduces already reach toward i128, which is exactly what creates the future mismatch risk against the per-row 2^96-1 settle-refund cap.
- To verify (3): extract 037's `CREATE OR REPLACE FUNCTION ...` body exactly as installed and compare byte-for-byte (including leading whitespace and newlines) against the `FN_GUARD_037` template literal in 038's `down()`. `pg_proc.prosrc` stores the body verbatim, so any indentation delta breaks an equality guard.

## Acceptance Criteria
- The FN_GUARD_037 conflict is resolved: either the const is re-indented to byte-match 037's `up()` body, or 038's docstring no longer claims byte-identity.
- `CHK_bid_settle_refund_cap`'s dependence on `CHK_bid_escrow_cap` is documented (or both derive from one constant).
- If implemented: the `offering_clearing_audit` trigger rejects soft-delete (NULL→ts) as well as update/hard-delete; the intentional partial-index omission is documented.

## Work Log
- 2026-08-20: created from PR #43 review (data-migration-expert + data-integrity-guardian)

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
Three migration-038 items: (1) Added a comment on `CHK_bid_settle_refund_cap` stating it MUST track migration
036's `CHK_bid_escrow_cap` (a loser's full refund = its escrow, already 2^96-1-bounded; if the escrow cap is
ever raised toward i128, raise this in lockstep or `flipRemainingEscrowedToLost` would 23514-wedge a large
loser). (2) Made `offering_clearing_audit` FULLY immutable — the append-only trigger now REJECTS soft-delete
(any `deleted_at` change) too, since a soft-deleted snapshot would be invisible to the read model while the
plain UNIQUE(offering_id) still blocks re-settlement (a settled offering with an irretrievable money artifact).
Added integration I3c. (3) CONFLICT VERIFIED: diffed 037's up() guard-fn body (6-space indent) vs 038's
`FN_GUARD_037` const (2-space) — they DIFFER in whitespace (migration-safety reviewer was right; data-integrity
was mistaken), so `pg_proc.prosrc` is not byte-identical. Softened both 038 docstring claims to "semantically
identical; indentation differs" rather than chase brittle whitespace (dev/test-only, down() prod-guarded,
nothing asserts prosrc). Re-provisioned tove_test; integration clearing spec 8/8.
