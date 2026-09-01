---
status: complete
priority: p3
issue_id: 441
tags: [code-review, tov-243, pr-57, observability, compliance, audit]
dependencies: []
---
# D7 flag: silent fail-open, happy-path noise, and stamping on noop/failed adds

## Resolution (2026-08-27) — Option 1: observability + tightened docs
Kept the audit-payload shape (`unboundExternalWallet: true`, omitted otherwise) — the three-state field
(option 2) was judged not worth the shape change for an advisory signal. **Applied** in
`backoffice-kyc-allowlist.service.ts`:
- **Observability (finding 1):** the fail-open `catch` now logs at `warn` (via a new class `Logger`) with
  `batchId` + affected-G-add count, so a systemic outage that silently disables the compliance signal is
  visible. `batchId` is threaded into `flagUnboundExternalAdds`. Behavior unchanged (still fail-open).
- **Happy-path noise (finding 2):** documented in the method JSDoc that the flag is EXPECTED on the primary
  rotation-prep flow (allowlist-before-bind) and should read as a "review this external add" prompt, not an
  anomaly. (Alerting/runbook guidance, not code.)
- **noop/failed stamping (finding 3):** JSDoc + the persist-stamp comment now state the flag is
  intent-based, not result-gated — an external-unbound add is recorded even if it resolves noop/failed.

Build clean; service unit 21 green (fail-open path unchanged, so existing assertions hold).

## Problem Statement
The D7 advisory flag (`unboundExternalWallet`) is correct in never blocking a batch, but three semantic
nuances weaken its value as a compliance signal. All are polish on an advisory path — none affect
money-safety.

## Findings
1. **Silent fail-open** — `backoffice-kyc-allowlist.service.ts:244-249`. A DB failure in
   `isKnownActiveByowAddress` is swallowed to `null` → the item is treated as bound → **no** flag, with no
   log. Fail-open *behavior* is right (must never fail a batch whose on-chain writes landed), but for a
   *compliance warning* the silent direction hides exactly the case a reviewer would want raised. The
   guard silently not-running for a whole batch is invisible.
2. **Flag fires on the intended happy path** — the primary flow is allowlist-the-rotation-destination
   *before* binding it, so the wallet is by definition not yet a live `wallets` binding →
   `unboundExternalWallet:true` stamps on essentially every legitimate rotation-prep add. A signal that
   fires on the normal path carries little discriminating value and invites reviewer habituation.
3. **Stamped on noop/failed G-adds too** — `backoffice-kyc-allowlist.service.ts:242` filters on request
   intent (`action==='add'`), not on the on-chain result, so a G-add that resolved to `noop` (already
   allowlisted) or `failed` still gets stamped (persist ~line 310). Arguably correct ("record the attempt")
   but the method JSDoc ("Omitted … for bound wallets and all C…/remove items") is silent on noop/failed.

## Proposed Solutions
1. **Add observability + tighten docs (recommended, Small).** Log at `warn`/`debug` (with wallet + batchId)
   in the fail-open catch; add a one-line JSDoc clarifying the noop/failed-add behavior. Pros: the outage
   case becomes visible; intent documented. Cons: none material.
2. **Three-state flag (Medium).** Emit `unboundExternalWallet: true | 'indeterminate'` so a lookup outage
   is *visible* in the audit row rather than silently clean, and optionally gate the `true` stamp on
   `r.status ∈ {confirmed, pending}` so the flag means "an external wallet is now (or provisionally)
   allowlisted." Pros: sharper semantics. Cons: audit-payload shape change + more test surface for an
   advisory field.
3. **Accept happy-path noise (doc-only).** Document in the runbook/alerting that the flag is expected on
   rotation-prep and is a "review this external add" prompt, not an anomaly. Pros: zero code. Cons: relies
   on process discipline.

## Recommended Action
_(triage — at minimum option 1)_

## Technical Details
- File: `src/modules/backoffice/kyc-allowlist/backoffice-kyc-allowlist.service.ts`
  (`flagUnboundExternalAdds` at ~:234-253; the persist stamp at ~:308-310).

## Acceptance Criteria
- [ ] A fail-open lookup error is logged (not silently dropped).
- [ ] The JSDoc states the noop/failed-add stamping behavior explicitly.
- [ ] (If option 2) the audit field distinguishes indeterminate from unbound; tests cover it.

## Work Log
- 2026-08-27: Raised by security-sentinel (two P3s) + kieran (P3) + performance-oracle (semantic note), PR #57.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/57
- Plan Decision D7: `docs/plans/2026-08-27-feat-allowlist-byow-g-address-plan.md`
