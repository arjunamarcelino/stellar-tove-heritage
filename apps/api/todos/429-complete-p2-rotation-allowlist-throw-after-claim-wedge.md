---
status: complete
priority: p2
issue_id: 429
tags: [code-review, tov-33, pr-56, security, liveness, money-path]
dependencies: []
---
# Transient allowlist-RPC failure after the CAS claim permanently wedges a rotation

## Resolution (2026-08-27) — Solution 1 (catch → recoverable fail)
- **`wallet-rotation.service.ts` submit loop**: the post-claim per-item allowlist re-check now calls
  `allowlist.isAllowed(...)` inside its own try/catch. On a THROW (RPC blip) the item is `markItemFailed`ed with
  `TRANSFER_UNAVAILABLE` (recoverable — re-built on the next `initiate`), audited, and the loop continues — never
  left stranded `submitted` with a non-zero balance. A returned `false` still fails it `RECIPIENT_NOT_WHITELISTED`
  (denied), preserving mid-drain-revocation semantics. The pre-loop check is unchanged (a throw there is before any
  claim → clean 503, no wedge).
- **Test**: unit spec — pre-loop `isAllowed` returns true, in-loop throws → asserts `markItemFailed(item,
  TRANSFER_UNAVAILABLE)`, item result `failed`, and `submitSignedTransfer` never called. Unit 19/19, build 0.

## Problem Statement
In the submit loop an item is CAS-claimed `pending→submitted` BEFORE the per-item on-chain allowlist re-check.
Rotation's allowlist re-check is a Soroban RPC (`KYC_ALLOWLIST_TX_SERVICE.isAllowed`) that **throws**
`read_unavailable` on any RPC flake. A throw here — after the claim, before the send — leaves the item stuck
`submitted` with no possible recovery: no fund loss, but the rotation is fully wedged and needs manual DB
intervention. This is a rotation-specific regression vs the export precedent (whose allowlist is an off-chain DB
read that returns a boolean and never throws mid-loop).

## Findings
- `src/modules/wallets/rotation/wallet-rotation.service.ts:280` claims the item (`claimItemForSubmit`), then
  `:285` runs `if (!(await this.isAllowlisted(rotation.destinationAddress)))`; `isAllowlisted` **throws**
  `read_unavailable` on RPC error (`:487-494`) instead of returning `false`.
- **Failure scenario:** item claimed (`submitted`) → allowlist RPC flakes → throw propagates out of the loop to the
  outer `catch → 503`. The transfer was **never sent**, yet the item is `submitted`. Recovery is impossible:
  - `claimItemForSubmit` only re-claims `pending|failed` → the next submit reports `{status:'submitted'}` and never
    re-sends (`wallet-rotation.repository.ts:75-82`).
  - `reconcileStuckItems` only confirms `submitted|failed` items whose balance is **zero**; here the balance is
    non-zero (never sent) → skipped (`:518-519`).
  - `cancel()` refuses because an item is `submitted` (`:419`, `cannot_cancel`).
  - `UQ_wrt_source_active` blocks starting a fresh rotation.
  → the user's rotation is stuck with no complete, cancel, or restart path. (security-sentinel P2)

## Proposed Solutions
1. **Wrap the per-item allowlist re-check in try/catch and `markItemFailed` on throw** (recoverable — a `failed`
   item is re-buildable on the next initiate). Pros: minimal, keeps the mid-loop revocation semantics. Cons: a
   transient RPC blip demotes the item to `failed` (re-initiate re-builds it — acceptable). Effort: Small.
2. **Move the allowlist re-check BEFORE `claimItemForSubmit`** so a throw leaves the item `pending` (naturally
   resumable). Pros: no state stuck past `pending`. Cons: a tiny TOCTOU window between check and claim (still
   backstopped by the completion re-read + chain). Effort: Small.
3. **Make `isAllowlisted` return a tri-state / not throw inside the loop** and treat "unavailable" as "skip this
   item, leave pending". Effort: Small–Medium.

## Recommended Action
(blank — triage)

## Acceptance Criteria
- [ ] A thrown allowlist RPC error during submit leaves the affected item in a resumable state (`pending`/`failed`),
      never a stuck `submitted` with a non-zero balance.
- [ ] Unit/integration test: allowlist read throws mid-submit → the rotation can still complete on retry or be
      canceled.

## Resources
- PR #56; reviewer: security-sentinel. Related liveness angle: todo 431 (conflict guard over-matches failed export).
