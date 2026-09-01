---
status: complete
priority: p2
issue_id: 438
tags: [code-review, tov-243, pr-57, security, rbac, compliance, policy]
dependencies: []
---
# External `G…` add sits at a lower privilege tier than the reversible `remove`

## Resolution (2026-08-27) — Option 2: require SUPERADMIN for external G-adds
Product decision (confirmed by the maintainer): **an `add` whose wallet is a `G…` account now requires
SUPERADMIN**, mirroring the existing per-item `remove` guard. Adding a platform-custodied `C…` smart-wallet
stays ADMIN+SUPERADMIN. Enforced in the service (one batch may mix kinds/actions), not just at the class
`@AdminRoles`, so a mixed batch is gated correctly.

**Applied:**
- `backoffice-kyc-allowlist.service.ts` — `requiresSuperadmin = items.some(remove || (add && isValidEd25519PublicKey(wallet)))`;
  a non-SUPERADMIN batch that trips it → 403 `FORBIDDEN` before any on-chain read/submit.
- `backoffice-kyc-allowlist.controller.ts` — 403 `@ApiResponse` wording updated.
- Tests: unit (ADMIN G-add → 403; SUPERADMIN G-add → confirmed; ADMIN C-add still allowed) + e2e
  (SUPERADMIN G-add → 200; ADMIN G-add → 403). Build clean, kyc-allowlist unit 24 / e2e 22 green.

This intentionally supersedes plan Decision D4's "uniform add" stance for the external-G case.

## Problem Statement
Before TOV-243, `add` could only allowlist `C…` smart-wallets, which are platform-custodied — a bounded,
platform-originated address space. After PR #57, an **ADMIN**-level actor (below the SUPERADMIN bar
deliberately required for the *reversible* `remove`) can allowlist **any** external `G…` account:
attacker-controlled, socially-engineered, or a valid-but-mistyped wallet. Allowlisting it makes it a valid
`FractionToken` recipient/holder and enables custody to leave the platform via TOV-33 rotation. The
higher-stakes, custody-granting action therefore sits at a *lower* privilege tier than the reversible one.

This was a **conscious decision** during planning (Decision D4 — keep `add` = ADMIN-or-SUPERADMIN, no
per-address-type branching; the D7 advisory audit flag is the compensating control). The security reviewer
re-raised it at P2 asking for an **explicit product sign-off** rather than an implicit inheritance of the
C-only RBAC posture. Not a code bug — a documented risk-acceptance (or a policy change) is what's missing.

## Findings
- `src/modules/backoffice/kyc-allowlist/backoffice-kyc-allowlist.service.ts:100-106` — RBAC: only `remove`
  is forced to SUPERADMIN; `add` stays ADMIN-or-SUPERADMIN (class-level `@AdminRoles(ADMIN, SUPERADMIN)`).
- `src/modules/backoffice/kyc-allowlist/dto/kyc-allowlist-item.dto.ts` — the widened validator now admits G.
- The only compensating control is the D7 advisory flag, which is itself noisy and fail-open (see #441).
- Elevating `add` to SUPERADMIN was previously argued *against* (add moves no money and is reversible;
  the confused-deputy bind-check, not a role bump, was chosen as the control). That argument holds **only
  if** the D7 bind-check is trusted; the reviewer's point is that an advisory, fail-open, happy-path-noisy
  flag is a weak compensating control for a custody-granting action.

## Proposed Solutions
1. **Accept + document (lowest effort).** Record the risk acceptance in the deploy runbook / compliance
   notes: external-G adds are ADMIN-authorized, audit-flagged, and gated operationally by compliance
   review before the admin acts. Pros: no code change, matches D4. Cons: relies on process, not the system.
2. **Split RBAC by StrKey kind (medium).** Require SUPERADMIN for any item whose wallet is a `G…` account
   (mirror the per-item `remove` check already in the service). Pros: the system enforces the higher bar
   for the higher-stakes action. Cons: a small policy reversal of D4; two ADMINs can no longer self-serve
   external adds; adds per-item role branching.
3. **Strengthen the D7 control instead (medium).** Keep uniform ADMIN but make the bind-check *harder*
   (e.g. hard-reject an unbound external G, per the originally-rejected D7 option). Pros: keeps RBAC
   uniform. Cons: couples allowlist admin to wallet-binding state; blocks legitimate allowlist-before-bind.

## Recommended Action
_(triage)_

## Technical Details
- Files: `backoffice-kyc-allowlist.service.ts` (RBAC block), `kyc-allowlist-item.dto.ts` (validator).
- No DB change for options 1–2; option 2 is a per-item guard mirroring the existing `remove` check.

## Acceptance Criteria
- [ ] A documented product/compliance decision on whether external-`G…` adds require SUPERADMIN.
- [ ] If option 2: a `G…` add by a plain ADMIN → 403; C-adds unaffected; covered by unit + e2e.
- [ ] Deploy runbook records the chosen posture.

## Work Log
- 2026-08-27: Raised by security-sentinel (P2) in the PR #57 review. Cross-refs the D4/D7 planning decisions.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/57
- Plan: `docs/plans/2026-08-27-feat-allowlist-byow-g-address-plan.md` (Decisions D4, D7)
