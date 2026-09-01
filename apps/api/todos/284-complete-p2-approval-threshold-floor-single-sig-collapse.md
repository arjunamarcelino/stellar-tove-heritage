---
status: complete
priority: p2
issue_id: 284
tags: [code-review, TOV-154, PR-39, security, config]
dependencies: []
---

# OFFERING_APPROVAL_THRESHOLD has no floor of 2 — threshold=1 silently collapses the multi-sig property

## Problem Statement
`OFFERING_APPROVAL_THRESHOLD` is `Joi.number().integer().min(1).default(2)` (`validation-schema.ts`
~line 151), and the config factory (`offering-escrow.config.ts`) only rejects `threshold > signers.length`,
duplicate signers, and non-UUID signer ids — there is **no floor of 2**. Setting `threshold=1` (a typo, or
a copy-paste from a single-signer service) makes a single rostered admin's approval reach
`count >= threshold`, which immediately triggers `casEscrowDeploying` + enqueue. The entire multi-sig
security property — "no single admin can unilaterally deploy a per-offering money escrow" — silently
collapses, and boot still succeeds.

## Findings
- **security-sentinel (MEDIUM/P2):** the min bound of `1` plus a config factory that never asserts a lower
  floor lets a one-approval quorum deploy an escrow, defeating the multi-sig control. Evidence:
  `validation-schema.ts:151` (`Joi.number().integer().min(1).default(2)`);
  `offering-escrow.config.ts:30,35-46` (assertions cover `threshold > signers.length`, duplicates, and
  non-UUID only — no `threshold < 2` check).

## Proposed Solutions
### Option A — Enforce a floor of 2 in both layers [recommended]
Change the Joi schema to `min(2)` and add an explicit `if (threshold < 2) throw` assertion in the config
factory (mirroring the existing `threshold > signers.length` check).
- **Pros:** fail-fast at boot; defends the property in both the schema and the factory. **Cons:** none of
  note. **Effort:** Small. **Risk:** Low.

### Option B — Explicit named opt-in for single-sig
If single-signature deploy is ever legitimately wanted, make it a separately-named explicit flag, never the
natural consequence of a small threshold number.
- **Pros:** keeps a documented escape hatch. **Cons:** more config surface; easy to misuse. **Effort:**
  Small-Medium. **Risk:** Medium (an opt-in that re-opens the same hole).

## Recommended Action
Do **Option A** — `Joi.min(2)` plus a `threshold < 2` throw in the config factory. Single-sig has no
legitimate use for a money escrow here; there's no reason to keep Option B's escape hatch.

## Technical Details
- `src/config/validation-schema.ts` (line 151)
- `src/config/offering-escrow.config.ts` (lines 30, 35-46)

## Acceptance Criteria
- [x] Boot fails fast if `OFFERING_APPROVAL_THRESHOLD < 2` (both the Joi schema and the config factory
      reject it).

## Resolution (2026-08-20 — Option A)
- `validation-schema.ts` — `OFFERING_APPROVAL_THRESHOLD` Joi bound raised `min(1)` → `min(2)`.
- `offering-escrow.config.ts` — added `if (threshold < 2) throw` to the factory boot assertions (before the
  `threshold > signers.length` check), so a `.env` typo crash-loops the app instead of silently shipping a
  single-sig quorum.
- Test: config spec +1 (`threshold='1'` → throws `/must be at least 2/`). Build + lint + config spec green.

## Work Log
- 2026-08-20 — Filed from PR #39 multi-agent review.
- 2026-08-20 — Resolved (Option A). Joi floor + factory assertion + unit test.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/39
