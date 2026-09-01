---
status: complete
priority: p3
issue_id: 206
tags: [code-review, security, privacy, kyc, TOV-29, PR-31, future-ticket]
dependencies: []
---

# `kyc_reason` / `whitelisted_at` on `users`: latent unprojected-serialization leak + future-erasure obligation

## Problem Statement
The two new columns live on `users`, which is a soft-delete entity that is never hard-purged (the current
`softDelete()` only nullifies `refreshTokenHash`). Two forward-looking hygiene items — **no live leak in
this PR** (the only serializer of these columns is `WhitelistStatusResponseDto`, and `UserResponseDto`
uses an explicit field allowlist), but the new columns inherit risks worth tracking:

1. **Unprojected full-entity loads now hydrate them.** `findByEmail` / `findByHandleCanonical` do
   `findOne({ where })` with no `select`, so the full `User` (now incl. `kycReason`, `whitelistedAt`) is
   materialized. Today those results reach clients only via `UserResponseDto.fromEntity` (safe). Any
   future code that returns one of these full `User` objects directly (`res.json(user)`,
   `instanceToPlain`) would emit the whitelist metadata.
2. **Erasure/retention.** `kyc_reason` is a compliance disposition tied to an identifiable user, living on
   the soft-deleted `users` row indefinitely. Not surfaced post-deletion (read path 404s on soft-deleted
   users), but a future right-to-erasure flow must explicitly null `kyc_reason` + `whitelisted_at`.

## Findings
- `src/modules/users/repositories/user.repository.ts` — `findByEmail`/`findByHandleCanonical` are unprojected `findOne`s that now hydrate the new columns. (security P3.)
- `src/modules/users/entities/user.entity.ts:53-59` — `whitelistedAt`/`kycReason` on the soft-delete `users` row; no erasure path exists today (consistent with the documented handle-restore caveat). (data-integrity P3.)
- Confirmed no current leak: `grep` shows `WhitelistStatusResponseDto` is the only serializing consumer; `UserResponseDto.fromEntity` allowlists fields.

## Proposed Solutions
### Option A (recommended): defensive projection + documentation
- Add explicit `select` projections to `findByEmail`/`findByHandleCanonical` (they only need auth-relevant columns), OR add a serialization guard (`@Exclude()` / a documented "never `res.json(user)`" rule) on `kycReason`/`whitelistedAt`.
- Add `kyc_reason` + `whitelisted_at` to the future erasure-scrub list; note in `users/CLAUDE.md` that both carry compliance-lifecycle data on the soft-deleted `users` row. **Effort: Small.**

## Recommended Action
**RESOLVED (Option A — documentation).** Added a ⚠️ note to `users/CLAUDE.md` recording that
`whitelisted_at`/`kyc_reason` are compliance-lifecycle data on the soft-deleted `users` row: (1) in-scope for a
future right-to-erasure scrub (must be nulled), and (2) only to be serialized via `WhitelistStatusResponseDto`
/ `UserResponseDto` (both allowlist fields) — never a full-`User` `res.json`/`instanceToPlain`. Deliberately did
NOT add `select` projections to `findByEmail`/`findByHandleCanonical`: those auth/handle lookups legitimately
need the full row, and under-selecting risks breaking auth — the doc guard + the existing DTO allowlists are
the right control (no live leak exists today).

## Technical Details
- Affected: `src/modules/users/repositories/user.repository.ts`, `src/modules/users/entities/user.entity.ts`, `src/modules/users/CLAUDE.md`.

## Acceptance Criteria
- [ ] `users/CLAUDE.md` records that `kyc_reason`/`whitelisted_at` are compliance data on the soft-deleted `users` row, in-scope for future erasure.
- [ ] The two new columns cannot be surfaced by an accidental full-`User` serialization (explicit projection or serialization guard).

## Work Log
- 2026-07-17: Filed from PR #31 review (security-sentinel P3, data-integrity P3). No code changed.
- 2026-07-17: RESOLVED. `users/CLAUDE.md` compliance-data note. Repo projections intentionally unchanged (auth needs full row). Doc-only. Status → complete.
