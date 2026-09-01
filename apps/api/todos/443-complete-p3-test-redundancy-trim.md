---
status: complete
priority: p3
issue_id: 443
tags: [code-review, tov-243, pr-57, test-quality, simplification]
dependencies: []
---
# Minor test redundancy in the widened encoder + pipe specs

## Resolution (2026-08-27) — trimmed (coordinated with #439)
- **Encoder spec** (`kyc-allowlist-encoding.spec.ts`): dropped the `checksum-invalid G-address` row (the
  standalone checksum test above already covers CRC16 failure) and one of the two lowercase entries (one
  lowercase case suffices to prove "no normalization"). The M/B/L invariant block from #439 is untouched.
- **Pipe spec** (`parse-strkey-address.pipe.spec.ts`): the pipe only delegates to `isValidStrKeyAddress`
  (exhaustively tested in the DTO predicate spec), so it now proves just the delegation contract —
  pass-through (C + G), one representative reject (muxed M…), and the pipe-specific non-string guard.
  Removed the checksum/lowercase singles and the shape `it.each` that re-tested the predicate.

Net −~15 test lines; both specs green (encoder 9, pipe 7).

## Problem Statement
The widened negative-test tables duplicate a couple of assertions already covered elsewhere. Trimming is
optional polish (~5-10 lines); flagged for completeness, not a blocker. Note this overlaps with #439 — if
#439's split-the-table refactor is done, fold this trim into the same edit.

## Findings
1. **Duplicate checksum + lowercase cases** — `test/unit/modules/kyc-allowlist/kyc-allowlist-encoding.spec.ts`
   (the widened `it.each`): `'checksum-invalid G-address'` duplicates the standalone
   `'rejects a shape-valid but checksum-invalid StrKey'` test right above it (same checksum-failure path),
   and `'lowercase G-address'` + `'lowercase contract'` are two entries asserting the single "no
   normalization" property. Collapse to one lowercase case; drop the redundant checksum-G row.
2. **Pipe spec re-tests the full predicate matrix** —
   `test/unit/modules/backoffice/kyc-allowlist/parse-strkey-address.pipe.spec.ts` re-runs the
   lowercase / checksum / too-short/long / non-base32 / empty / non-string matrix that the DTO predicate
   spec already covers. The pipe only *delegates* to `isValidStrKeyAddress`; its spec really needs only:
   (a) valid C and G pass through unchanged, (b) one invalid → `BadRequestException`, (c) a non-string
   input doesn't throw from the SDK predicates. The shape `it.each` is testing the predicate a second time.

## Proposed Solutions
1. **Trim (recommended if touched, Small).** Drop the checksum-G row + one lowercase entry from the encoder
   table; reduce the pipe spec's shape matrix to one invalid case (keep C/G pass-through + non-string).
   Pros: less duplication. Cons: marginally less redundancy-as-belt.
2. **Leave as-is (accept).** The extra cases are cheap and harmless. Pros: zero change.

## Recommended Action
_(triage — low priority; coordinate with #439)_

## Technical Details
- Files: `test/unit/modules/kyc-allowlist/kyc-allowlist-encoding.spec.ts`,
  `test/unit/modules/backoffice/kyc-allowlist/parse-strkey-address.pipe.spec.ts`.

## Acceptance Criteria
- [ ] No duplicate checksum/lowercase assertions in the encoder table.
- [ ] Pipe spec focuses on delegation (pass-through + one reject + non-string), not the full predicate matrix.
- [ ] All kyc-allowlist unit specs stay green.

## Work Log
- 2026-08-27: Raised by code-simplicity-reviewer (2 P3s) in the PR #57 review. Overlaps with #439.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/57
