---
status: complete
priority: p2
issue_id: 128
tags: [code-review, security, compliance, export, TOV-40]
dependencies: []
---

# Re-check the KYC allowlist inside the per-item submit loop (intra-drain TOCTOU)

## Problem Statement
`submit()` calls `kyc.isAllowed(exp.targetAddress)` once at the top, then loops over items submitting each on-chain (each item is a full simulate → lock → send → poll, spanning many seconds). If a compliance revocation lands after the check but during the multi-item drain, the remaining items still move funds to the now-revoked address. The surrounding comment claims "a revocation in the gap must block," but the implementation only closes the initiate→submit-start gap, not the intra-drain window.

## Findings
- `src/modules/wallets/export/wallet-export.service.ts:175` — single allowlist check before the loop.
- `wallet-export.service.ts:197-247` — per-item loop; each `submitSignedTransfer` includes `pollForTransfer` (FIRST_POLL_DELAY_MS + ledger closes), so the loop can span tens of seconds for N items.

## Proposed Solutions

### Option A: Re-check `isAllowed(exp.targetAddress)` immediately before each `submitSignedTransfer`
- **Description:** Inside the loop, before submitting an item, re-run the allowlist check; on failure mark that item failed with `RECIPIENT_NOT_WHITELISTED` and stop/skip remaining items.
- **Pros:** Cheap DB read per item; actually closes the intra-drain TOCTOU the comment claims; treats the allowlist as authoritative at each money movement.
- **Cons:** One extra indexed read per item; a mid-drain revocation yields a partially-drained export (acceptable — the tracker + status endpoint already model partial settlement).
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — re-check `isAllowed(exp.targetAddress)` per item, immediately after the claim, before sending.

## Implemented Solution
Added a per-item allowlist re-check in the submit loop: after an item is claimed (CAS) and before
`submitSignedTransfer`, `kyc.isAllowed(exp.targetAddress)` is re-evaluated; on a revocation the item is
marked `failed` with `RECIPIENT_NOT_WHITELISTED` and the loop continues (partial settlement). This closes
the intra-drain TOCTOU the surrounding comment claimed — the target is now authoritative at each money
movement, not just at submit-start (the top-of-submit check remains for a fully-revoked target → 422).

## Technical Details
Affected: `src/modules/wallets/export/wallet-export.service.ts` (submit loop). Added an e2e asserting a
revoke (soft-delete) between initiate and submit blocks the drain with `RECIPIENT_NOT_WHITELISTED`.

## Acceptance Criteria
- [x] A revocation blocks the remaining items (per-item re-check).
- [x] E2E covers revoke-after-initiate → `RECIPIENT_NOT_WHITELISTED`.

## Work Log
- 2026-07-14: Filed from PR #25 review (security reviewer).
- 2026-07-15: Added per-item allowlist re-check + e2e. build + lint + 8 export e2e green. Marked complete.
