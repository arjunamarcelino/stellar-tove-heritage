---
status: complete
priority: p3
issue_id: 273
tags: [code-review, typescript, quality, test-quality, TOV-241, PR-37]
dependencies: []
---

# Two small TypeScript polish nits (lastLedger asymmetry comment + dto-spec `??` framing)

## Problem Statement
Two independent, low-severity polish items from the TS review:

1. **`lastLedger` number-in / string-out asymmetry is undocumented.** The upsert input types `lastLedger: number | null` while the entity/DTO type it `string | null`. It works (write goes through raw SQL; TypeORM returns `bigint` as `string`), but the same logical column is `number` in and `string` out — a latent trap for anyone who later read-modify-writes the value expecting a round-trip type.

2. **A dto-spec test over-claims its rationale.** The case titled "uses ?? not || so a genuine is_allowed=false row is not confused with never-seen" asserts on `isAllowed`, but for `isAllowed` specifically `false ?? false` and `false || false` both yield `false` — so the assertion would pass even with the buggy `||`. The real never-seen discriminator is `updatedAt`/`lastAction` (which the test does check elsewhere). Production code is correct; only the test's framing is misleading.

## Findings
Flagged by **kieran-typescript-reviewer (P3 ×2)**.
- `src/modules/kyc-allowlist/repositories/kyc-allowlist-state-repository.interface.ts:12` (`KycAllowlistStateUpsert.lastLedger: number`) vs entity `:27` (`string | null`).
- `test/unit/modules/backoffice/kyc-allowlist/kyc-allowlist-status-response.dto.spec.ts:51-55`.

## Proposed Solutions
1. **lastLedger:** add a one-line comment on `KycAllowlistStateUpsert.lastLedger` noting the intentional number-in / string-out bigint asymmetry (or normalize the write side to `string`). Effort: trivial.
2. **dto-spec:** re-comment/rename the case to assert on the `updatedAt`/`lastAction` discriminator (which it already checks) and drop the "?? not ||" claim from the `isAllowed` line — or add a field where `??` and `||` genuinely diverge. Effort: trivial.

## Recommended Action
**RESOLVED — both polished.**
1. Added a comment on `KycAllowlistStateUpsert.lastLedger` documenting the intentional number-IN / string-OUT
   bigint asymmetry (confirmed-result `number` in; TypeORM `bigint`→`string` out) with a "don't normalize" note.
2. Reframed the dto-spec case: renamed to "distinguished from never-seen by non-null provenance (not by
   isAllowed)" and added a comment explaining that `false ?? false === false || false`, so the real `?? not ||`
   guard is proven by the non-null provenance (updatedAt/lastAction), which it now asserts.

## Technical Details
- `src/modules/kyc-allowlist/repositories/kyc-allowlist-state-repository.interface.ts`.
- `test/unit/modules/backoffice/kyc-allowlist/kyc-allowlist-status-response.dto.spec.ts`.

## Acceptance Criteria
- [x] `lastLedger` number-vs-string asymmetry is documented.
- [x] The dto-spec case no longer over-claims the `?? vs ||` guard for `isAllowed`; asserts the real discriminator.
- [x] Build + dto spec (6) green.

## Work Log
- 2026-08-18: created from PR #37 review (kieran-typescript-reviewer, two P3 nits bundled).
- 2026-08-18: RESOLVED — lastLedger asymmetry comment + reframed dto-spec case. Build + unit(6) green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/37
