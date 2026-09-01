---
status: complete
priority: p2
issue_id: 136
tags: [code-review, security, testing, export, TOV-40]
dependencies: []
---

# Add a test locking the export money-pin invariant (expectedTo + expectedAmountScaled always passed)

## Problem Statement
The export surface's security rests on `expectedTo` + `expectedAmountScaled` being passed to `submitSignedTransfer` on every item (pinning the recipient to the allowlisted target and the exact frozen amount). Both are OPTIONAL fields on the relayer input — the transfer path deliberately omits them. A future refactor that drops either field silently reverts export to "user chooses `to`" / "≤ ceiling" semantics with no compile-time signal. There is currently no test asserting the export service always populates them (the verifier unit tests cover the check, but the gated live-testnet transfer test is skipped in CI).

## Findings
- `src/modules/relayer/passkey-authorization.ts:157,173` — pins are optional (`expectedTo?`, `expectedAmountScaled?`).
- `src/modules/wallets/export/wallet-export.service.ts` submit — passes them, but nothing locks the invariant.

## Proposed Solutions

### Option A: Service-level test capturing the SubmitSignedTransferInput
- **Description:** With a fake relayer that records `submitSignedTransfer` inputs, assert every export submit call has `expectedTo === exp.targetAddress` and `expectedAmountScaled === item.amountScaled`. No live wallet needed.
- **Pros:** Locks the invariant against regression cheaply; complements the existing verifier unit tests.
- **Cons:** None material.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — assert on the recorded `submitCalls` (FakeRelayerService already records them).

## Implemented Solution
Added an e2e that runs a happy export and then inspects `relayer.submitCalls` (sliced to this test's
calls): every call must have `expectedTo === TARGET` and `expectedAmountScaled` === the frozen snapshot
amount. This fails the moment the export submit path stops pinning the recipient or the exact amount —
locking the security invariant (B1/B3) against regression without needing a live wallet.

## Technical Details
Affected: `test/e2e/wallet-export.e2e-spec.ts` (+1 test). Relies on `FakeRelayerService.submitCalls`
capturing the `SubmitSignedTransferInput` (incl. `expectedTo`/`expectedAmountScaled`).

## Acceptance Criteria
- [x] A test fails if the export submit path ever omits `expectedTo` or `expectedAmountScaled`.

## Work Log
- 2026-07-14: Filed from PR #25 review (security reviewer).
- 2026-07-15: Added the pin-invariant e2e. lint + 10 export e2e green. Marked complete.
