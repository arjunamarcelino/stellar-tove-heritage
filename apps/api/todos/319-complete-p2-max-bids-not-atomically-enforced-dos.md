---
status: complete
priority: p2
issue_id: 319
tags: [code-review, reliability, tov-160]
dependencies: []
---
# `MAX_BIDS_PER_OFFERING` is not atomically enforced — a concurrent bid burst can exceed the cap and deny settlement

## Problem Statement
`assertBiddable` reads `countActiveForOffering` and then inserts the bid in a **separate** transaction. The only DB-level uniqueness is one-active-bid-**per-collector** (`UQ_offering_bids_active_per_collector`); there is no total-count cap constraint. When the active count equals `maxBidsPerOffering - 1`, N distinct whitelisted collectors bidding concurrently can each pass the read-side check and insert, pushing the active count over 40 (`MAX_BIDS_PER_OFFERING`). Once over cap, **every** settle path hard-rejects: the HTTP backoffice path rejects with `OFFERING_TOO_MANY_BIDS`, and the worker settle belt's `assertClearingInvariants` treats `bidCount > maxBids` as terminal. The float can never mint and proceeds never pay until collectors voluntarily cancel back under the cap — a denial-of-settlement on the highest-stakes operation. Funds remain recoverable (cancel only checks `status === 'opened'` and works after the window), and exploiting it requires many KYC identities plus a near-cap race, so it is P2, not P1.

## Findings
- `src/modules/offerings/bids/offering-bids.service.ts` — `assertBiddable` calls `countActiveForOffering` and inserts in a separate transaction; the read and the insert are not atomic with respect to the count cap.
- DB constraint `UQ_offering_bids_active_per_collector` — enforces one active bid per collector only; there is **no** constraint bounding the total active-bid count per offering.
- `src/modules/offerings/backoffice-offerings.service.ts` — HTTP settle path rejects an over-cap offering with `OFFERING_TOO_MANY_BIDS`.
- `clearing.ts` `assertClearingInvariants` (worker settle belt) — treats `bidCount > maxBids` as a **terminal** invariant break.
- **Constant:** `MAX_BIDS_PER_OFFERING = 40`. Exceeding it wedges both settle paths simultaneously; recovery requires collectors to cancel back under cap.

## Proposed Solutions
### Option A — Atomic conditional insert
- Description: Replace the read-then-insert with a single conditional insert that enforces the cap atomically, e.g. `INSERT ... SELECT ... WHERE (SELECT count(*) FROM offering_bids WHERE offering_id = :id AND <active>) < :max`, returning zero rows (→ rejection) when at cap.
- Pros: Makes the cap a hard invariant no concurrent burst can breach; keeps the existing 40 cap and both settle-path guards intact.
- Cons: Slightly more complex SQL; the counting subquery adds contention under heavy concurrent bidding (bounded by the row-lock/serialization already present).
- Effort: Medium
- Risk: Low

### Option B — Tolerate up to the measured on-chain resource cliff at settle time
- Description: Instead of rejecting at the same submit-time cap, let the settle belt tolerate bid counts up to the empirically measured on-chain resource/ledger limit, so a small overshoot still settles.
- Pros: Removes the denial-of-settlement even when overshoot occurs; decouples the submit-time guard from the settle-time guard.
- Cons: Requires measuring and pinning the true on-chain cliff; a moving target across contract/protocol changes; still benefits from a submit-time cap to avoid unbounded growth.
- Effort: Medium
- Risk: Medium

## Recommended Action
Option A — atomic conditional insert (`INSERT ... WHERE (SELECT count(*) active) < :max`). It closes the race at the source with a hard invariant, keeps the existing settle-path guards meaningful, and avoids depending on an empirically-moving on-chain cliff. Option B can be layered later as defense-in-depth if the measured cliff proves comfortably above 40.

## Technical Details
The gap is a classic check-then-act TOCTOU: the count read and the insert are in different transactions with no serializing constraint bridging them. A per-collector unique constraint does not bound the aggregate. An atomic conditional insert (or an equivalent advisory-lock-guarded count+insert) collapses the window. Both settle paths already treat over-cap as fatal, so preventing the overshoot is the correct layer to fix; loosening the settle guards (Option B) is a separate, additive hardening.

## Acceptance Criteria
- Under a concurrent burst of N distinct collectors bidding while active count is `maxBidsPerOffering - 1`, the final active count never exceeds `MAX_BIDS_PER_OFFERING` (integration/concurrency test).
- Over-cap rejection surfaces as a clean bid-time error, not a wedged settle.
- Existing one-active-bid-per-collector behavior is unchanged.

## Work Log
- 2026-08-20: created from PR #43 [security-sentinel] review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
Enforced the MAX_BIDS_PER_OFFERING cap ATOMICALLY inside `submit()`'s insert transaction: a per-offering
transaction-scoped `pg_advisory_xact_lock(hashtext(offeringId))` serializes concurrent submits on the same
offering, then the active-bid count is re-read and rejected (`OFFERING_TOO_MANY_BIDS`, 409) before the
insert. Because the advisory lock blocks a racing submit until the prior one commits, each submit observes
the previous inserted row — so N distinct collectors racing at `count == max-1` can no longer all pass and
push the book over the cap (the previous `assertBiddable` read-then-insert in separate statements left a wide
race window that could make an offering permanently unsettleable). The `assertBiddable` count check is kept
as the fast-fail pre-check (avoids building/signing a doomed tx). Advisory-lock contention is negligible
(the insert txn is short, and on-chain bid relay already serializes on the relayer account lock). Unit
suite green (32/32); the race itself is not deterministically unit-testable, so correctness rests on the
lock semantics.
