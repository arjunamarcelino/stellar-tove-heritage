---
status: complete
priority: p2
issue_id: 258
tags: [code-review, correctness, idempotency, TOV-152, PR-36]
dependencies: []
---

# Idempotency fingerprint hashes raw timestamps → false 422 mismatch on a legit retry

## Problem Statement
The idempotency fingerprint hashes the **raw** `window_open_at` / `window_close_at` strings. Stroops are regex-canonicalized (so equal amounts hash identically), and the DTO doc explicitly claims this "can't produce a false idempotency `mismatch`" — but that normalization was never applied to the timestamps. A client that retries the same logical request with a re-serialized-but-equivalent timestamp gets `422 IDEMPOTENCY_KEY_MISMATCH` instead of a clean `201` replay.

## Findings
Flagged by **kieran-typescript-reviewer (P2)** and **security-sentinel (P3)** — same root cause, converged.
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts` — `fingerprint()` builds its canonical JSON from `dto.window_open_at` / `dto.window_close_at` verbatim.
- `2026-09-01T00:00:00Z`, `2026-09-01T00:00:00.000Z`, and `2026-09-01T00:00:00+00:00` all pass `@IsISO8601` + `TZ_OFFSET_RE`, all persist the **identical** instant, yet produce three different SHA-256 fingerprints.
- Real trigger: an HTTP/JSON layer round-tripping a `Date` (e.g. `JSON.stringify(new Date())` → `.000Z`) re-serializes the timestamp on retry. The `UQ_offerings_active_per_artwork` index still prevents a double-create, so the failure mode is a confusing `422` (not data corruption) — it fails safe, but breaks the intended replay UX.
- Security note: not an exposure (fails toward rejecting), correctness/UX only.

## Proposed Solutions
1. **Canonicalize timestamps in `fingerprint()` before hashing** — `new Date(dto.window_open_at).toISOString()` (the value is already validated parseable). Mirrors the stroops canonicalization the code already relies on. Effort: Small. Risk: very low.
2. Document the exact-bytes contract to clients (they must send byte-identical bodies on retry). Effort: trivial, but pushes the burden onto every caller and contradicts the DTO's own "can't produce a false mismatch" claim. Weaker.

## Recommended Action
**RESOLVED — Solution 1.** `fingerprint()` now canonicalizes both window timestamps via `new Date(x).toISOString()` before hashing (safe: they're validated parseable by step 2's window check). Timezone-equivalent windows now produce one fingerprint, so a legit same-key retry replays the 201 instead of a false 422.

## Technical Details
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts` — `fingerprint()` private helper.
- The persisted value already uses `new Date(...).toISOString()`; align the fingerprint with it.

## Acceptance Criteria
- [x] Two requests with the same `Idempotency-Key` and timezone-equivalent-but-differently-serialized window timestamps return the same `201` (replay), not `422`.
- [x] Unit test covers `Z` vs `.000Z` vs `+00:00` equivalence on the fingerprint.

## Work Log
- 2026-08-18: created from PR #36 review (kieran-typescript-reviewer P2, security-sentinel P3).
- 2026-08-18: RESOLVED — canonicalized timestamps in `fingerprint()` (`backoffice-offerings.service.ts`); added a `fingerprint canonicalizes timestamps` describe block (2 tests: Z/.000Z/+00:00 equal, different instant differs). Offerings unit suite 43→45; build + lint green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/36
