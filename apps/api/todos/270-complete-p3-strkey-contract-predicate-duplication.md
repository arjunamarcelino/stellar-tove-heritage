---
status: complete
priority: p3
issue_id: 270
tags: [code-review, quality, dry, architecture, TOV-241, PR-37]
dependencies: []
---

# StrKey-contract predicate duplicated between the pipe and the DTO validator

## Problem Statement
The path-param pipe and the body DTO validator hand-roll the byte-identical predicate `typeof value === 'string' && StrKey.isValidContract(value)`. The PR already shares the human *message* (`STRKEY_CONTRACT_MESSAGE`) so text can't drift, but the *rule itself* is copied. If the contract-address rule ever tightens (e.g. an added length assertion), the two validators can silently diverge — path-param validation and body validation of the same wallet concept would disagree.

## Findings
Flagged by **code-simplicity-reviewer (P3)** and **architecture-strategist (P3)** independently.
- `src/modules/backoffice/kyc-allowlist/pipes/parse-strkey-contract.pipe.ts:17`.
- `src/modules/backoffice/kyc-allowlist/dto/kyc-allowlist-item.dto.ts:22-23` (`IsStrKeyContract.validate`).

## Proposed Solutions
1. **Extract a shared predicate** — `export function isValidStrKeyContract(value: unknown): boolean` next to `STRKEY_CONTRACT_MESSAGE`; have both the pipe and `IsStrKeyContract.validate` call it. Pros: rule + message now both single-source, provably can't drift; net LOC ≈ 0; coupling flows pipe→helper (cleaner than pipe→DTO). Cons: one more tiny exported symbol; Effort: Small.
2. **Accept as-is** — it's a single well-known SDK call unlikely to change independently. Pros: zero effort. Cons: leaves the (small) drift surface; Effort: none.

## Recommended Action
**RESOLVED — Solution 1 (extract shared predicate).** Added `isValidStrKeyContract(value: unknown): value is string`
next to `STRKEY_CONTRACT_MESSAGE` in `dto/kyc-allowlist-item.dto.ts`. Both `IsStrKeyContract.validate` (body)
and `ParseStrKeyContractPipe` (path param) now call it, so the rule AND the message are single-source and
can't drift. Bonus: making it a **type predicate** lets the pipe `return value` with no cast (the guard
narrows `unknown → string`).

## Technical Details
- `src/modules/backoffice/kyc-allowlist/dto/kyc-allowlist-item.dto.ts` — new `isValidStrKeyContract` predicate.
- `src/modules/backoffice/kyc-allowlist/pipes/parse-strkey-contract.pipe.ts` — imports + uses it (dropped the direct `StrKey` import).

## Acceptance Criteria
- [x] The predicate exists in exactly one place; pipe + `IsStrKeyContract` both call it.
- [x] Existing pipe (12) + batch-DTO (16) tests stay green; build clean.

## Work Log
- 2026-08-18: created from PR #37 review (code-simplicity-reviewer + architecture-strategist, both P3).
- 2026-08-18: RESOLVED — extracted `isValidStrKeyContract` type-predicate shared by validator + pipe. Build + unit(28) green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/37
