---
status: complete
priority: p3
issue_id: 364
tags: [code-review, performance, cleanup, tov-174, pr-47]
dependencies: []
---
# Inbox read + fan-out insert efficiency trims (PR #47)

## Problem Statement
A cluster of small, real efficiency trims on the read + insert paths. None block merge; all are cheap wins.

## Findings
Source: performance-oracle (A MEDIUM, B/C LOW, INFO), kieran-typescript-reviewer (#4), code-simplicity-reviewer (#7).

**A [MEDIUM] — pagination `getCount()` carries two needless JOINs.**
`src/modules/marketplace/notifications/repositories/rfq-notification.repository.ts:100-103` — `total` is
`inboxQuery().clone().getCount()`, but every count predicate is on `n.` alone (`recipient_sub`, `deleted_at`,
optional `read_at`). The inner joins to `rfqs`/`artworks` (both to PK, 1:1, non-filtering) are pure
nested-loop overhead paid on every list page. Give the count its own join-free builder → an index-only count
on `IDX_rfq_notifications_inbox`/`_unread`.

**C [LOW] — fan-out UNNEST insert ships `RETURNING "id"` the caller discards.**
`rfq-notification.repository.ts:45-50` runs `… RETURNING "id"` and returns `inserted.length`, but the sole
caller (`rfq-fanout.service.ts:54`) ignores it (the audit `recipientCount` uses `winnerSubs.length`). For a
hot artwork with M holders, M UUIDs are materialized and shipped back purely to be counted and thrown away.
Also the `Array.isArray(inserted) ? … : 0` guard is redundant on an `INSERT … RETURNING` (always an array).
Drop `RETURNING`, return `void` (or `result.rowCount`), remove the guard.

**B [LOW] — offset pagination deep-page cost.**
`rfq-notification.repository.ts:107-108` uses `.offset((page-1)*limit)`; the index is explicitly keyset-ready
(`(recipient_sub, created_at DESC, id DESC)`). Acceptable for an inbox (limit≤100, users rarely deep-paginate)
— document as the known ceiling; keyset (`WHERE (created_at,id) < (:cursor)`) makes every page O(limit) if
inbox depth ever becomes real. (Security-sentinel L1 flagged the same as a mild self-inflicted latency ceiling.)

**INFO — redundant residual `ob.allocated_count > 0`.**
`src/modules/offerings/repositories/offering-bid.repository.ts:251` — `won` implies `allocated_count > 0` via
CHECK, so it filters zero rows. Harmless; drop only if you want the query text to match the index predicate.

## Proposed Solutions
- A: join-free count builder (Recommended, real per-request win).
- C: drop `RETURNING`/count/guard, make `insertManyIgnoreConflicts` return `Promise<void>` (or consume rowCount).
- B: keep offset now; note keyset as the scale path.
- INFO: optional residual removal.
Effort: Small · Risk: Low (all).

## Recommended Action
Apply A + C; document B; keep the redundant `allocated_count > 0` as a defensive belt (not removed).

## Resolution (2026-08-21, complete)
- **A (count join-free):** `listForRecipient` now builds a separate, JOIN-FREE count query (`n.` predicates
  only) → index-only count on IDX_rfq_notifications_inbox/_unread; the rfqs/artworks joins no longer run on the
  count path. The paged display query keeps its single JOIN.
- **C (drop discarded RETURNING):** `insertManyIgnoreConflicts` dropped `RETURNING "id"` and the redundant
  `Array.isArray` guard; signature is now `Promise<void>` (interface + impl). It no longer ships M UUIDs back to
  be discarded. The audit `recipientCount` was already sourced from `winnerSubs.length`, not this return.
- **B (offset ceiling):** documented inline that offset is acceptable for an inbox and the `(created_at,id)`
  index is keyset-ready for a cheap cutover if depth grows. Kept offset (base-code consistency + provides `total`).
- **INFO (allocated_count residual):** KEPT as a defensive belt — removing a correctness predicate for
  query-text cosmetics isn't worth it.
- Files: `rfq-notification.repository.ts`, `rfq-notification-repository.interface.ts`. tsc + lint clean;
  integration 8 + e2e 4 green (count totals + insert unaffected).

## Acceptance Criteria
- [ ] The inbox count query no longer joins `rfqs`/`artworks`.
- [ ] The fan-out insert does not ship a discarded `RETURNING` payload; its signature matches its actual use.
- [ ] Deep-offset ceiling documented (or keyset adopted).

## Work Log
- 2026-08-21: Filed from PR #47 review (performance A/B/C + typescript + simplicity).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/47
