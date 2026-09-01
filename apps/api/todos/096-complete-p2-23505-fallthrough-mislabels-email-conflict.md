---
status: complete
priority: p2
issue_id: 096
tags: [code-review, correctness, data-integrity, tov-21]
dependencies: []
---

# 23505 Handler Positionally Assumes "Email Conflict" on Any Non-Credential/Contract Violation

## Problem Statement
`WalletsService.createEmbeddedPasskeyWallet` maps unique-constraint (23505) violations by substring:
if `constraint` contains `credential_id`/`contract_address` → `PASSKEY_ALREADY_BOUND`, **else** →
`AUTH_EMAIL_CONFLICT`. The `else` is positional, not positive: any *other* unique violation (a
future index on wallets/passkey_credentials, or an empty `err.constraint` from a pooler/driver that
strips it) is silently mislabeled as an email conflict. `constraintName()` returning `''` also routes
to the email branch. Correct today (the only other reachable unique index is `UQ_users_email_active`),
but fragile and invisible.

## Findings
- `src/modules/wallets/wallets.service.ts:141-159` — `else` branch assumes email.
- `src/modules/wallets/wallets.service.ts:164-170` — `constraintName` returns `''` when absent → email branch.
- Flagged by data-integrity-guardian (P2) and architecture-strategist (LOW).

## Proposed Solutions

### Option A: Make the email branch explicit; generic 409 otherwise (recommended)
```ts
if (constraint.includes('credential_id') || constraint.includes('contract_address'))
  → PASSKEY_ALREADY_BOUND
else if (constraint.includes('email'))
  → AUTH_EMAIL_CONFLICT
else
  → generic ConflictException (no misleading errorCode) OR rethrow
```
- **Pros:** No silent misrouting; future-proof. **Cons:** none material. **Effort:** Small · **Risk:** Low

### Option B: Exact-name matching via a constant map
- Match `err.constraint` against the known index names exactly (also fixes architecture LOW re: brittle substrings). Optionally inspect `err.detail` as a fallback when `constraint` is absent.
- **Effort:** Small · **Risk:** Low

## Recommended Action
_(triage — Option A is the minimal safe fix; consider B for the substring brittleness)_

## Technical Details
- File: `src/modules/wallets/wallets.service.ts`
- Index names: `UQ_passkey_credentials_credential_id_active`, `UQ_wallets_contract_address_active`, `UQ_users_email_active`.

## Acceptance Criteria
- [ ] A non-email unique violation no longer surfaces as `AUTH_EMAIL_CONFLICT`.
- [ ] Empty/absent `err.constraint` does not route to the email branch.
- [ ] Unit test covers each 23505 branch by constraint name.

## Work Log
- 2026-07-02: Filed from PR #21 code review.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/21
- 2026-07-02: RESOLVED — email branch made explicit (`constraint.includes('email')`); unknown unique violations now rethrow instead of defaulting to AUTH_EMAIL_CONFLICT. Build+lint+tests green.
