---
status: complete
priority: p3
issue_id: 377
tags: [code-review, correctness, idempotency, tov-175, pr-48]
dependencies: []
---
# Idempotency replay body diverges for `validUntilCapped` between the Redis and DB-backstop paths (PR #48)

## Problem Statement
The same `Idempotency-Key` can return `validUntilCapped: true` on a Redis replay but omit it on a DB-backstop
replay (the crash-window path). The RFQ precedent deliberately keeps ephemeral fields OUT of the persisted
snapshot so both replay paths are byte-identical; here the fresh path stores the flag but the durable path
can't reconstruct it (there is no `valid_until_capped` column). The field is display-only, hence P3.

## Findings
Source: kieran-typescript-reviewer (P3-2).
- `src/modules/marketplace/quotes/quotes.service.ts:180` — fresh path: `fromEntity(saved, { validUntilCapped })`
  (flag included in the `stored` snapshot passed to `complete()`).
- `src/modules/marketplace/quotes/quotes.service.ts:187` — durable-backstop: `fromEntity(existing)` (no flag).
- `dto/quote-response.dto.ts:26-40` — the DTO comment already acknowledges this.

## Proposed Solutions
### Option A — Accept + document (mirror RFQ's `balanceWarning` treatment) (Recommended)
- Explicitly document that `validUntilCapped` is a fresh/Redis-replay-only hint; the rare DB-backstop replay
  omits it. The capped `valid_until` value itself is always correct (persisted); only the boolean hint differs.
- Pros: zero change; consistent with how RFQ treats its ephemeral `balanceWarning`. Cons: a (very rare) replay
  body can differ by one boolean.
- Effort: Small · Risk: None
### Option B — Persist a marker the backstop can read
- Store a `valid_until_capped` boolean column (or derive by comparing the quote's `valid_until` to the RFQ's
  `expires_at` at replay time).
- Pros: byte-identical replays always. Cons: a column/derivation for a display-only hint; deriving needs an RFQ
  read on the backstop path.
- Effort: Small-Medium · Risk: Low

## Recommended Action
Option A — document the fresh-only semantics (the RFQ `balanceWarning` precedent). Revisit only if a client
depends on byte-identical replay of the hint.

## Resolution (2026-08-22, complete — Option A, documented)
Documented the semantics in-code: the persisted `valid_until` is always the capped value; only the ephemeral
`validUntilCapped` HINT is fresh/Redis-replay-only (no column to recover it from on the rare crash-window
durable backstop) — mirroring how RFQ treats its fresh-only `balanceWarning`. Comment added at the
durable-backstop branch in `quotes.service.ts`; the DTO JSDoc already noted it. No behavior change (a normal
Redis replay is still byte-identical). Build 0.

## Technical Details
- Affected: `quotes.service.ts` (comment), `quote-response.dto.ts` (already noted).

## Acceptance Criteria
- [x] The `validUntilCapped` replay semantics are documented (fresh/Redis-only) in the service + DTO.

## Work Log
- 2026-08-22: Filed from PR #48 review (kieran-typescript-reviewer P3-2).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/48
