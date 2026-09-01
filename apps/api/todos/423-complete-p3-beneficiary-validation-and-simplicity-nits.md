---
status: complete
priority: p3
issue_id: 423
tags: [code-review, tov-31, pr-54, quality, simplicity, validation, security]
dependencies: []
---
# Beneficiary validation / simplicity / hygiene nits (bundled P3s)

## Resolution (2026-08-26)
**Applied:** (1) extended `FORBIDDEN_CONTROL_CHARS` to also block C1 controls (0x80–0x9F) + `U+2028`/`U+2029`
(`set-beneficiary.dto.ts`); (4) `stellarPubkey` now normalizes through the shared `optional()` helper
uniformly with relationship/notes (`beneficiary.service.ts`, still trim-only — never lowercases); (5) dropped
the redundant `: boolean` annotation on `shown` (`beneficiary-response.dto.ts`); (6) added a cross-reference
comment noting this notice fails SAFE vs `WhitelistStatusResponseDto`'s fail-LOUD; (8) removed the redundant
`DROP INDEX` before `DROP TABLE` in migration `050`'s `down()`.
**Consciously declined:** (2) kept the runtime-built regex over a literal — it's equally source-clean and the
char-code build is safer against the toolchain mangling `\uXXXX`/`\xXX` escapes; (3) kept both normalization
layers — the DTO `@Transform(trim)` is **load-bearing** (without it a whitespace-only `name` passes
`@IsNotEmpty` then fails the DB `CHK_..._name_nonempty` as a 500); the service `normalize()` is the diff's
source of truth; (7) kept `String(err)` in the erasure log — matches the house `AuditLogService` pattern and
the failing statement carries no PII; (9) left the `deleteByUserId`/`applyUpdate` round-trips (perf-oracle:
not worth it; `deleteByUserId` was already collapsed for correctness in #422).
Build 0 issues; lint clean; beneficiary unit 16 / integration 8 / e2e 5 green.

## Problem Statement
A cluster of low-severity, non-blocking cleanups surfaced across the PR #54 multi-agent review. None are bugs; each is a small readability, robustness, or defense-in-depth win.

## Findings
1. **Control-char filter is C0-only.** `src/modules/users/beneficiary/dto/set-beneficiary.dto.ts:19-24` blocks C0 (0x00–0x1F, minus tab/LF/CR) + DEL, but **not** C1 controls (0x80–0x9F) or `U+2028`/`U+2029` (line/paragraph separators). The DTO comment concedes it's defense-in-depth only (real defense = downstream output-encoding), so acceptable — but a consumer rendering these fields into a non-HTML sink (CSV/terminal/PDF) shouldn't over-trust the "blocks control characters" guarantee. (security-sentinel P3)
2. **Runtime-built regex where a literal is equally safe + clearer.** Same lines — `Array.from(...).filter(...).concat(...).map(...).join('')` buys nothing over `/^[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F]*$/` (ASCII escapes also put no control byte in source). (code-simplicity P3, kieran P3)
3. **Double normalization.** DTO `@Transform` (trim / lower+trim) and service `normalize()` (`beneficiary.service.ts:95-103`) both trim `name` and lower+trim `email`. Harmless but two sources of truth — the service `normalize` is the one the diff depends on; the DTO transforms are redundant for those two fields. (code-simplicity P3, kieran P3)
4. **`stellarPubkey` normalize idiom differs.** `beneficiary.service.ts:99` uses `dto.stellarPubkey?.trim() || null` while relationship/notes go through `optional()`; folding pubkey through `optional()` (which does not lowercase — the case-sensitivity note stays true) reads uniformly. (kieran P3)
5. **`?? true` is type-dead + redundant annotation.** `beneficiary-response.dto.ts:72` — `NOTICE_SHOWN[kycStatus]` is `boolean` (total map), so `?? true` looks dead to a types-only reader; it's intentional runtime defense against a drifted varchar `kyc_status` (keep it), but the `: boolean` annotation is redundant. (kieran P3)
6. **Notice fail-mode diverges from its sibling — add a cross-ref.** `beneficiary-response.dto.ts:72` fails **safe** (drift → notice shown) whereas the mirrored `whitelist-status-response.dto.ts:63-65` fails **loud** (drift → 500). Both defensible (advisory notice vs authoritative status), but a one-line cross-reference prevents a future reader assuming symmetry. (pattern-recognition P3)
7. **Erasure log stringifies raw DB error.** `beneficiary-erasure.service.ts:24` interpolates `String(err)`; the failing statement is `DELETE … WHERE id=$1` (no PII), so risk is low, but it places raw driver internals in logs. (security-sentinel P3, cosmetic)
8. **Redundant `DROP INDEX` in `down()`.** `1716000000050-CreateBeneficiariesTable.ts:56-57` — `DROP TABLE` already drops owned indexes. Cosmetic. (data-migration-expert P3)
9. **Two-query micro-ops explicitly NOT worth doing.** `deleteByUserId` + `applyUpdate` each do 2 round-trips; collapsing to `… RETURNING` saves sub-ms at this volume — performance-oracle recommends **leaving them** (except `deleteByUserId`, which has a correctness reason — see todo 422). Recorded so it isn't re-raised.

## Proposed Solutions
### Option A — Apply the safe, obvious cleanups (Recommended)
Items 2 (literal regex), 3 (drop DTO transforms for name/email OR drop the service re-normalize — pick one layer), 4 (uniform `optional()`), 5 (drop redundant annotation), 6 (cross-ref comment), 8 (drop redundant DROP INDEX). Optionally extend the char filter (item 1) to C1 + U+2028/2029 or invert to a Unicode-category allowlist. Leave item 9. Effort: Small · Risk: Low.

## Recommended Action
(blank — triage)

## Technical Details
- Affected: `dto/set-beneficiary.dto.ts`, `beneficiary.service.ts`, `dto/beneficiary-response.dto.ts`, `beneficiary-erasure.service.ts`, `1716000000050-CreateBeneficiariesTable.ts`.

## Acceptance Criteria
- [ ] Each nit is applied or consciously declined with a reason.

## Work Log
- 2026-08-26: Filed from PR #54 multi-agent code review (simplicity/kieran/security/pattern/migration/performance P3s).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/54
