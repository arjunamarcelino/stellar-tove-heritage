---
status: complete
priority: p2
issue_id: 161
tags: [code-review, type-safety, wallets, audit, tov-25]
dependencies: []
---

## Resolution (complete — 2026-07-15)
Applied Option A. Added `export type AuditKind = (typeof AUDIT_KIND)[keyof typeof AUDIT_KIND]` in
`audit-log.types.ts` and changed `NewAuditEntry.kind` from `string` to `AuditKind`. Tightening surfaced one
loose caller — `WalletExportService.auditItem(kind: string)` — now typed `AuditKind` too (all its callers
already passed `AUDIT_KIND.*`). A bogus kind string is now a compile error. `src` typechecks clean.

# Type audit `NewAuditEntry.kind` as `AuditKind`, not `string`

## Problem Statement
`AUDIT_KIND` is an `as const` map (`src/modules/wallets/export/audit-log.types.ts`), but
`NewAuditEntry.kind` is typed `string`. So the compile-time safety the `as const` implies is defeated at the
consumption boundary: any string is accepted, and a typo or drift in a caller's `kind` is not caught. TOV-25
adds a **second** producer of audit rows (`me-wallets.service.ts` primary-changed events), which is exactly
when the loose typing starts to cost correctness.

## Findings
- `src/modules/wallets/export/audit-log.types.ts` — `AUDIT_KIND` `as const`; `NewAuditEntry.kind: string`.
- Producers now: export lifecycle (`wallet-export.service.ts`) + primary changes (`me-wallets.service.ts`).
- The integration test hardcodes the literal `'wallet.primary.changed'` in raw SQL — a typed `kind` would not
  catch that, but would catch drift in the TypeScript callers.

## Proposed Solutions
### Option A (recommended): Derive a union type from the const map
```ts
export type AuditKind = (typeof AUDIT_KIND)[keyof typeof AUDIT_KIND];
// NewAuditEntry.kind: AuditKind;
```
- **Pros:** callers must use an `AUDIT_KIND.*` value; new kinds are added in one place; zero runtime change.
- **Cons:** any legitimate free-form kind (none today) would need adding to the map. **Effort: Small.**

### Option B: Leave as `string`
- **Pros:** no change. **Cons:** no compile safety for a now-multi-producer facility. **Effort: None.**

## Recommended Action
_(triage)_

## Technical Details
- File: `src/modules/wallets/export/audit-log.types.ts`; verify all `AuditLogService.record` callers pass an
  `AUDIT_KIND.*` value (they do).

## Acceptance Criteria
- [ ] `NewAuditEntry.kind` is a union derived from `AUDIT_KIND`.
- [ ] All callers compile; a bogus kind string is a compile error.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #27 (kieran-typescript-reviewer).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/27
