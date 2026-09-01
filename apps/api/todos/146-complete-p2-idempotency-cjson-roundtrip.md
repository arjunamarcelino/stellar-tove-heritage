---
status: complete
priority: p2
issue_id: 146
tags: [code-review, correctness, idempotency, redis, TOV-24]
dependencies: []
---

# `IdempotencyStore.complete` re-encodes the record through Redis `cjson`, risking a lossy round-trip

## Problem Statement
The `COMPLETE` Lua does `ok.b = cjson.decode(ARGV[2]); redis.call('set', KEYS[1], cjson.encode(ok), …)`,
re-encoding the whole record server-side through Redis's `cjson`. Redis `cjson` has documented divergences
from Node's `JSON.parse` used on the read side: an empty object `{}` re-emits as `[]`, and large integers
lose precision. Today the stored body is always `{ walletId: <uuid string> }`, so it's safe — but
`IdempotencyStore` lives in `common/` and is documented as a generic primitive (`body: unknown`,
"completed response body"), so a future caller storing `{}`, a number, or a nested numeric id would get a
silently reshaped replay body.

## Findings
- `src/common/idempotency/idempotency-store.ts` — `COMPLETE` Lua (`ok.b = cjson.decode(ARGV[2])` then
  `cjson.encode(ok)`); read side `JSON.parse(raw)` in `begin`.
- Not an injection vector — `ARGV`/`KEYS` are passed as `eval` params, not concatenated. Purely a codec
  round-trip fidelity issue (security reviewer P2).

## Proposed Solutions

### Option A: Store the body as an opaque JSON string; never `cjson.decode` it (recommended)
Set `ok.b` to the raw `ARGV[2]` string (no decode); on read, `JSON.parse(record.b)`. Removes Redis `cjson`
from the value path entirely, so the two JSON codecs can't diverge.
- **Pros:** Fully codec-safe for any body shape; simplest mental model.
- **Cons:** `record.b` becomes a string that the caller JSON-parses (one extra parse).
- **Effort:** Small · **Risk:** Low

### Option B: Constrain/type the store to string-valued bodies only + document the limitation
- **Pros:** No Lua change.
- **Cons:** Leaves a footgun in a `common/` primitive; weaker.
- **Effort:** Small · **Risk:** Medium (relies on every caller respecting the constraint)

## Recommended Action
Option A (store the body as an opaque JSON string; never `cjson.decode` it).

## Implemented Solution
`src/common/idempotency/idempotency-store.ts`:
- The `COMPLETE` Lua now does `ok.b = ARGV[2]` (the raw JSON string), **not** `cjson.decode(ARGV[2])`, so
  Redis `cjson` never round-trips the body *value*. The record then holds only strings (`s`/`f`/`t`/`b`), so
  the outer `cjson.encode` is lossless too.
- `StoredRecord.b` retyped `string` (opaque serialized body); `begin`'s replay path `JSON.parse`s it back.
- Added `test/integration/common/idempotency-store.integration.spec.ts` (real Redis) asserting object /
  **empty-object** / **large-number** / boolean bodies replay unchanged — the exact `{}`→`[]` / big-int
  cases that would corrupt under server-side cjson. 4 tests green.

## Technical Details
Affected: `src/common/idempotency/idempotency-store.ts` (`COMPLETE`, `complete`, `begin`, `StoredRecord`).
New test hits localhost Redis directly (like the e2e suite). Interacts with [[150]]/[[152]].

## Acceptance Criteria
- [x] Completed body survives a store→replay round-trip byte-identically for objects, empty objects, and
      numeric values.
- [x] A test asserts `{}` / numeric-id bodies replay unchanged (real-Redis integration spec).

## Work Log
- 2026-07-15: Filed from PR #26 security review (cjson round-trip P2).
- 2026-07-15: Fixed — body stored as an opaque JSON string (no server-side cjson on the value). Real-Redis
  test added covering `{}`/big-int/boolean bodies.
