---
status: complete
priority: p2
issue_id: 191
tags: [code-review, architecture, nestjs, kyc, TOV-28]
dependencies: []
---

## Resolution (complete — 2026-07-17) — Option A (dedicated token)
Added `STORAGE_BUCKET_OVERRIDE` DI token; `SupabaseStorageService`'s override param is now
`@Optional() @Inject(STORAGE_BUCKET_OVERRIDE) bucketOverride?: string` (can't be satisfied by an unrelated
`string` provider). `kyc.module.ts` no longer hand-rolls `new SupabaseStorageService(...)` — it provides
`STORAGE_BUCKET_OVERRIDE` from `kycConfig.bucket` and `KYC_STORAGE` as `useClass: SupabaseStorageService`,
so both storage providers resolve through DI. Verified `supabaseConfig.bucket` is non-optional `string`
(so the earlier `!`-drop is correct). Build + lint + KYC e2e (8) green.

# SupabaseStorageService bucket override is a positional @Optional() param wired via hand-rolled `new`

## Problem Statement
The KYC bucket is threaded into `SupabaseStorageService` as a bare positional `@Optional() bucketOverride?:
string`, and the `KYC_STORAGE` provider constructs the service by hand (`new SupabaseStorageService(...)`)
in a `useFactory`, bypassing Nest DI. Two construction paths (the default `useClass` and the hand-rolled
`new`) can silently drift if constructor args are reordered or a new dependency is added — no compile error.

## Findings
- `src/modules/storage/supabase-storage.service.ts:17-20` — `@Optional() bucketOverride?: string` positional param.
- `src/modules/kyc/kyc.module.ts:47-51` — `useFactory: (...) => new SupabaseStorageService(supCfg, kycCfg.bucket)` constructs outside DI.
- `src/modules/storage/supabase-storage.service.ts:35` — `this.bucket = bucketOverride ?? config.bucket` (dropped the old `!`; correct only if `supabaseConfig.bucket` type is non-optional `string` — confirm under strict null checks).

## Proposed Solutions
### Option A (recommended): dedicated injection token
- Add `export const STORAGE_BUCKET_OVERRIDE = 'STORAGE_BUCKET_OVERRIDE'`; constructor `@Optional() @Inject(STORAGE_BUCKET_OVERRIDE) bucketOverride?: string`. In `kyc.module.ts` provide `SupabaseStorageService` normally plus `{ provide: STORAGE_BUCKET_OVERRIDE, useFactory: (kycCfg) => kycCfg.bucket, inject: [kycConfig.KEY] }` scoped to the KYC provider — both paths go through DI. **Pros:** self-documenting, no `new`, no positional-primitive footgun. **Cons:** slightly more wiring. **Effort: Small.**

### Option B: minimal hardening
- Keep the factory but add `@Inject()` to the positional param so it can never be satisfied by an unrelated `string` provider, and add a comment. **Effort: Small.**

## Recommended Action
_(triage)_

## Technical Details
- Affected: `src/modules/storage/supabase-storage.service.ts`, `src/modules/kyc/kyc.module.ts`.
- Verify `supabaseConfig`'s `ConfigType.bucket` is `string` (not `string | undefined`) so removing `!` compiles.

## Acceptance Criteria
- [ ] The KYC bucket override is provided via a named token through DI (or the positional param is `@Inject()`-guarded).
- [ ] Both the default `files` provider and the KYC `tove-kyc` provider resolve correctly; storage tests green.

## Work Log
- 2026-07-17: Filed from PR #30 review (kieran #1). No code changed.
