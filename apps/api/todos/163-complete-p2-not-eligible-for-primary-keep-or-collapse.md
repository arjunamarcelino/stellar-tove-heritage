---
status: complete
priority: p2
issue_id: 163
tags: [code-review, simplicity, wallets, tov-25, api-contract]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Decision (confirmed with the requester): **Option A — keep `WALLET_NOT_ELIGIBLE_FOR_PRIMARY` as a
forward-guard.** It matches the earlier brainstorm choice to reject exported wallets distinctly and is
defensive if a BYOW wallet ever becomes exportable. No behavior change; added a code comment in
`setPrimaryWallet` explaining why the `status` check precedes the `kind` check and why the distinct 409 is
retained despite `exported ⟹ embedded` today. The `affected===0` re-read (which selects between
`not_eligible_for_primary`/`not_found`) is retained for the same forward-guard reason.

# Decide: keep `WALLET_NOT_ELIGIBLE_FOR_PRIMARY` (409) or collapse into the kind check (422)

## Problem Statement
`setPrimaryWallet` rejects an exported wallet with `409 WALLET_NOT_ELIGIBLE_FOR_PRIMARY` before the
embedded-kind check (`src/modules/wallets/wallets.service.ts:180-181`). But in this codebase
**`status='exported'` ⟹ `kind='embedded_passkey'`** (only the embedded-wallet drain sets exported —
`wallet-export.service.ts`). So the `kind !== 'byow'` check alone already rejects every exported wallet; it
would just map to `422 WALLET_KIND_NOT_SUPPORTED`. The distinct 409 + status branch exists only to give a
*different* HTTP response to "exported embedded" vs "active embedded", plus a dependent `affected===0` re-read
that selects between the two codes (`wallets.service.ts:194-197`).

The plan deliberately kept the distinct 409 as a **forward-guard** (in case a BYOW wallet ever becomes
exportable) and to match a brainstorm Gherkin scenario. The simplicity reviewer questions whether it earns
its keep. This is a design decision to confirm, not a bug.

## Findings
- `wallets.service.ts:180-181` — status check ordered before kind check (forward-guard for exported byow).
- `wallets.service.ts:194-197` — `affected===0` re-read exists partly to pick `not_eligible` vs `not_found`.
- `wallet-export.service.ts` — export gate proves exported ⟹ embedded today.
- The TOV-25 AC/Gherkin does NOT mark `WALLET_NOT_ELIGIBLE_FOR_PRIMARY` as an AC-mandated literal (only
  `PRIMARY_WALLET_CANNOT_BE_REMOVED` is so marked).

## Proposed Solutions
### Option A: Keep as-is (forward-guard) — current behavior
- **Pros:** precise 409 for exported wallets; defensive if byow becomes exportable; matches brainstorm.
- **Cons:** an error code + union member + branch + a re-read that are unreachable-for-real-data today.
  **Effort: None.**

### Option B: Collapse into the kind check
- Drop `WALLET_NOT_ELIGIBLE_FOR_PRIMARY`, the status branch, and simplify the `affected===0` path to a single
  `not_found`; all non-byow (incl. exported embedded) → `422 WALLET_KIND_NOT_SUPPORTED`.
- **Pros:** ~10-14 fewer lines, one fewer error code/concept. **Cons:** loses the forward-guard and the
  distinct 409; requires updating the integration test + brainstorm expectation. **Effort: Small.**

## Recommended Action
_(triage — depends on whether product wants a distinct exported-vs-embedded signal; if not, Option B)_

## Technical Details
- Files: `src/modules/wallets/wallets.service.ts` (180-197), `wallet-mutation.error.ts`,
  `src/common/enums/error-code.enum.ts`, `test/integration/.../primary-wallet.integration.spec.ts`.

## Acceptance Criteria
- [ ] Decision recorded (keep vs collapse) with rationale tied to the TOV-25 AC.
- [ ] If collapsing: code, enum, union, and tests updated; brainstorm/plan note amended.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #27 (code-simplicity-reviewer). Note the exported-vs-kind
  ordering was a conscious plan decision (see plan "exported ⟹ embedded").

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/27
- Plan: `docs/plans/2026-07-15-feat-primary-settlement-wallet-endpoint-plan.md`
