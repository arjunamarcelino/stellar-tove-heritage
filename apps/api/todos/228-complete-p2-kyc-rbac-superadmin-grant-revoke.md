---
status: complete
priority: p2
issue_id: 228
tags: [code-review, security, authz, TOV-235, PR-33]
dependencies: []
---

# Grant/revoke of on-chain spendability is allowed for ADMIN, not restricted to SUPERADMIN

## Problem Statement
The endpoint signs + submits irreversible on-chain `add`/`remove` transactions that grant/revoke a Collector wallet's ability to move fraction tokens — the most privileged non-repudiable action in the backoffice. It is currently gated to both `ADMIN` and `SUPERADMIN`.

## Findings
- `src/modules/backoffice/kyc-allowlist/backoffice-kyc-allowlist.controller.ts:21` → `@AdminRoles(AdminRole.ADMIN, AdminRole.SUPERADMIN)`.
- The `AdminRole` enum has exactly two roles; `ADMIN` is the broad role. Any `ADMIN` can whitelist an arbitrary wallet for on-chain movement, or `remove` a legitimate Collector (denial).
- This mirrors `BackofficeArtworksController` (fractionalize), but allowlisting is closer to a money/permission grant than to content administration; the controller's own comment acknowledges it "grants/revokes on-chain spendability."

## Proposed Solutions
### Option A (recommended): SUPERADMIN-only for remove (and consider add)
- Gate `remove` (freeze/deny a Collector) to `SUPERADMIN`; decide whether `add` also warrants SUPERADMIN. Per-action roles require setting `@AdminRoles` at the handler, not the class (guard reads `getAllAndOverride([handler,class])`). Effort: Small.

### Option B: keep ADMIN+SUPERADMIN, document the decision
- If product intends `ADMIN` to grant spendability, document it in the controller + plan and ensure `ADMIN` provisioning is tightly controlled. Effort: Small.

## Recommended Action
**RESOLVED (Option A).** `remove` now requires SUPERADMIN; `add` stays ADMIN+SUPERADMIN. Because one batch may mix actions, enforcement is at the service level: if the caller is not superadmin and any item is a `remove`, the request is rejected `403 FORBIDDEN` before idempotency/reads/submit. Controller passes the full `AdminJwtPayload` (role isn’t on the JwtPayload union). Unit + e2e tests assert ADMIN+remove→403 and SUPERADMIN+remove→200.

## Technical Details
- Affected: `src/modules/backoffice/kyc-allowlist/backoffice-kyc-allowlist.controller.ts`.

## Acceptance Criteria
- [x] Decision: add = ADMIN+SUPERADMIN; remove = SUPERADMIN-only.
- [x] e2e + unit assert plain-ADMIN + remove → 403; superadmin + remove → 200.

## Work Log
- 2026-07-18: created from PR #33 review (security-sentinel P2).

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/33
- 2026-07-18: RESOLVED — service-level RBAC (remove→superadmin); tests green.
