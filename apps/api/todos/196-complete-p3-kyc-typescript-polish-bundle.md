---
status: complete
priority: p3
issue_id: 196
tags: [code-review, quality, typescript, kyc, TOV-28]
dependencies: []
---

## Resolution (complete — 2026-07-17) — all 6 items
1. `replay` now type-guards the Redis body (throws INTERNAL_ERROR if malformed) and routes through
   `KycSubmissionResponseDto.fromEntity` (single construction site).
2. Idempotency dispatch is an exhaustive `switch (begin.outcome)` with `default: assertNever(begin)`
   (`@common/utils/assert-never`) — a future 5th outcome is now a compile error, not a silent `proceed`.
3. `hashes` is `Record<KycDocType, string>` (was `Record<string, string>`).
4. New-document rows use a precise `NewKycDocumentRow = Pick<KycDocument, …8 columns>` (was
   `DeepPartial<KycDocument>`), so a missing required column is a compile error.
5. `MulterExceptionFilter.MAP` is keyed by `MulterError['code']` (`Partial<Record<…>>`) — a typo'd key
   is now a compile error.
6. Removed the duplicate `maxFileBytes` from `kyc.config.ts` (it was unused); the per-file cap has a single
   source of truth: `KYC_MAX_FILE_BYTES` in `kyc-file.validator.ts` (also the Multer interceptor limit).

All KYC unit (34) + e2e (9) + build + lint green.

# KYC TypeScript polish bundle (6 small items)

## Problem Statement
Six small type-safety / consistency nits in the KYC module, grouped since each is a few lines. None are
bugs; they tighten types and align with established codebase patterns (me-wallets/audit).

## Findings
1. **`replay` blind cast + duplicate DTO builder** — `src/modules/kyc/kyc.service.ts:227-234` casts `body as SubmitBody` with no guard (the body round-trips through Redis + `JSON.parse`), and hand-builds the DTO while the happy path uses `KycSubmissionResponseDto.fromEntity` (`:197`). `me-wallets.service.ts:181-187` narrows the identical `IdempotencyBegin.body: unknown` with a type guard. → add a guard (throw INTERNAL_ERROR on malformed) and route `replay` through `fromEntity`.
2. **Idempotency dispatch is an if-chain** — `kyc.service.ts:85-101` is four `if`s falling through to `proceed`. `IdempotencyBegin` is a discriminated union; a 5th outcome would silently be treated as `proceed`. → `switch (begin.outcome)` with `default: assertNever(begin)`.
3. **`hashes: Record<string, string>`** — `kyc.service.ts:73` loses the `KycDocType` key domain. → `Record<KycDocType, string>`.
4. **`docRows: DeepPartial<KycDocument>[]`** — `kyc.service.ts:105,168` is looser than the fully-known data; a missing required column would compile. → `Pick<KycDocument, 'submissionId'|'docType'|'storageKey'|'encryptedDek'|'dekKeyVersion'|'blobHash'|'contentType'|'byteSize'>[]`.
5. **`MulterExceptionFilter.MAP: Record<string, ErrorCode>`** — `multer-exception.filter.ts:14,22` keyed by `string`; a key typo compiles. → key by `MulterError['code']` (`Partial<Record<...>>`).
6. **`maxFileBytes` duplicated** — `src/config/kyc.config.ts` hardcodes `10*1024*1024` and `src/modules/kyc/kyc-file.validator.ts:7` defines `KYC_MAX_FILE_BYTES` separately (same value). Two sources of truth for the size cap. → single source (config → validator/interceptor).

## Proposed Solutions
### Option A: apply the six one-liners opportunistically
- Each is independent and low-risk; #1 and #2 align with the codebase's established idempotency-handling pattern and are the most valuable. **Effort: Small each.**

## Recommended Action
_(triage — low priority; #1/#2 first as they match the me-wallets pattern.)_

## Technical Details
- Affected: `src/modules/kyc/kyc.service.ts`, `src/modules/kyc/dto/kyc-submission-response.dto.ts`, `src/modules/kyc/multer-exception.filter.ts`, `src/config/kyc.config.ts`, `src/modules/kyc/kyc-file.validator.ts`.

## Acceptance Criteria
- [ ] `replay` guards the body shape and reuses `fromEntity`; idempotency dispatch is an exhaustive switch.
- [ ] `hashes`/`docRows`/Multer map use their precise key/element types.
- [ ] The per-file size cap has a single source of truth.
- [ ] Build + lint (`--max-warnings 0`) + tests stay green.

## Work Log
- 2026-07-17: Filed from PR #30 review (kieran #4/#5/#6/#7/#9, simplicity F2, deployment P3-2). No code changed.
