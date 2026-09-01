---
status: complete
priority: p2
issue_id: 399
tags: [code-review, tov-191, pr-51, security, cursor, input-validation]
dependencies: []
---
# Crafted cursor with out-of-range `o` throws RangeError → 500 (contract says 400)

## Resolution (2026-08-24) — Option A
`isCursorPayload` now validates `o` as `Number.isSafeInteger(o) && o >= 0 && o <= MAX_CURSOR_EPOCH_MS` (`8_640_000_000_000_000`, the JS `Date` ceiling). A tampered cursor with `o = 1e16` now returns a clean `400 TIMELINE_INVALID_CURSOR` instead of reaching `new Date(o).toISOString()` → `RangeError` → 500. `Number.isSafeInteger` also rejects >2^53 junk. The `MAX_CURSOR_EPOCH_MS` boundary is inclusive (verified round-trip).

**Lower bound / pre-1970 (the P3 sub-item):** kept `o >= 0` (forward-only) and documented it inline — all current emitters stamp `new Date()`, so no legitimate negative epoch exists yet. A comment marks it "revisit if backdated pre-1970 events are emitted", so the next ticket adding a backdated-provenance writer must relax this bound (and is now on notice).
- Files: `src/modules/timeline/timeline-cursor.ts`.
- Tests: unit (out-of-range → 400, boundary round-trip, over-max → 400) + e2e (`?cursor=<huge o>` → 400, never 500). Verified 8 unit / 11 e2e pass.

## Problem Statement
`isCursorPayload` in the keyset cursor codec validates the epoch-ms field `o` as `Number.isInteger(o) && o >= 0` but imposes **no upper bound**. JS `Date` maxes at ±8.64e15 ms, yet `Number.isInteger(1e16)` is `true`. A structurally valid, base64url-encoded cursor `{v:1, o:1e16, i:<uuid>}` (≤512 chars) clears `@IsBase64Url`, `@MaxLength(512)`, and `isCursorPayload`, then reaches the repo where `new Date(args.cursor.occurredAtMs).toISOString()` throws `RangeError: Invalid time value`. That escapes uncaught → `AllExceptionsFilter` → **HTTP 500**, on a public anonymous endpoint (bounded only by 30/min throttle). This directly contradicts the codec's own docstring ("a tampered `{o:1.5}` / non-uuid `i` / non-JSON all throw a clean 400"). No data leak, but an unhandled-exception input-validation gap. Flagged independently by security-sentinel and kieran-typescript-reviewer (both P2).

**Related, opposite end of the same bound (P3):** the `o >= 0` *lower* bound rejects pre-1970 timestamps. `occurred_at` is a business event time and the CHECK vocabulary includes inherently historical types (`exhibition`, `loan`, `condition_report`, `attestation`). For any backdated event, `getTime()` is negative; `encodeCursor` encodes it happily but `decodeCursor` rejects `o < 0` → the server's own `nextCursor` self-rejects with 400, dead-ending pagination at the first pre-1970 boundary. Not reachable today (both emitters stamp `new Date()`), but the schema + read path both admit historical dates, so the next ticket adding a backdated-provenance insert path walks into it.

## Findings
- `src/modules/timeline/timeline-cursor.ts:36-47` — `isCursorPayload`: `Number.isInteger(o) && o >= 0`, no upper bound; `o >= 0` too strict for historical dates.
- `src/modules/timeline/repositories/timeline-read.repository.ts:54` — `new Date(args.cursor.occurredAtMs).toISOString()` is the throw site.
- Verified: `new Date(1e16).toISOString()` and even `new Date(9e15)` throw `RangeError`.

## Proposed Solutions
### Option A — Bound `o` to a realistic epoch window in `isCursorPayload` (Recommended)
Replace `o >= 0` with `Number.isSafeInteger(o) && o >= MIN_MS && o <= MAX_MS`, where `MAX_MS ≈ 8.64e15` (JS Date max) or tighter (`Date.now()` + slack), and `MIN_MS` either `0` (keep forward-only) or a negative floor if historical events are in scope. Closes the 500 with zero legitimate-traffic impact.
- Pros: one-file, precise, keeps the "malformed → 400" contract honest. Cons: must decide the historical-date policy now.
- Effort: Small · Risk: Low.

### Option B — try/catch the `Date` conversion in the repo, map to `invalidCursor()`
Wrap `new Date(...).toISOString()` and re-throw the 400. Defense-in-depth but leaves the codec's guard incomplete (validation belongs in the codec).
- Pros: catches any future Date-range surprise. Cons: 400-mapping logic leaks into the repo layer.
- Effort: Small · Risk: Low.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `timeline-cursor.ts`, `timeline-read.repository.ts`. No schema change.
- Add a unit test: base64url `{v:1,o:1e16,i:<uuid>}` → expect `BadRequestException` (TIMELINE_INVALID_CURSOR), not a throw/500.

## Acceptance Criteria
- [ ] A cursor with `o` beyond JS Date range → `400 TIMELINE_INVALID_CURSOR` (not 500).
- [ ] Decision recorded on pre-1970 `occurred_at` (either allow negative `o` or document forward-only).
- [ ] Unit test covers the out-of-range `o` case.

## Work Log
- 2026-08-24: Filed from PR #51 review (security-sentinel + kieran-typescript, both P2).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/51
