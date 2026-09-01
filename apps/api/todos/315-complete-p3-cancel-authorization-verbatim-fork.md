---
status: complete
priority: p3
issue_id: 315
tags: [code-review, simplicity, security, relayer, tov-158]
dependencies: []
---
# `cancel-authorization.ts` is a ~150-line verbatim fork of `bid-authorization.ts` (rule-of-three shared frame)

## Problem Statement
`verifyCancelBidAuthorization` steps 0/1/2/4/5/6 (presence; single-op/single-Address-cred + reject SOURCE_ACCOUNT; root-is-contract-fn byte-equal; challenge binding; authenticatorData UP/UV; low-S P256 integrity) are byte-identical to `verifyBidAuthorization`. Only step 3 differs (`cancel_bid` 2-arg root-only vs `submit_bid` 4-arg + sub-invocation). This is now the THIRD copy of the frame (transfer → bid → cancel) — a textbook rule-of-three trigger. Also the `buildCancelBid`/`submitSignedCancelBid`/`pollForCancel` trio (~120 lines) near-duplicates the build/submit/poll trio.

## Findings
- `src/modules/relayer/cancel-authorization.ts` steps 0-2/4-6 ≡ `src/modules/relayer/bid-authorization.ts` steps 0-2/4-6.
- `src/modules/relayer/soroban-relayer.service.ts` — `buildCancelBid`/`submitSignedCancelBid`/`pollForCancel` mirror `buildBid`/`submitSignedBid`/`pollForBid`.
- This is deliberate fail-closed money-auth code; each verifier is independently golden-vector-pinned and auditable top-to-bottom. The documented fork rationale in `bid-authorization.ts:12-24` is about NOT touching the audited TOV-22 transfer verifier — it does not argue against a shared frame between the two NEW forks.

## Proposed Solutions
### Option A — Extract on the fourth (defer)
- Description: Ship as-is (rule-of-three line reached, but the variation is genuinely just step 3 and the fail-closed independence has real value). If a fourth escrow-verb verifier appears, extract then.
- Pros: Preserves per-verifier auditability + independent golden vectors on money code now; no audit cost incurred.
- Cons: ~150 lines duplicated remain.
- Effort: —
- Risk: —

### Option B — Extract a shared envelope now
- Description: `parseAndVerifyAuthFrame(input)` runs steps 0-2, calls a `pinRootInvocation(opInvocation, rootInvocation, addressCreds)` callback for step 3, then runs steps 4-6. The seam is clean (steps 4-6 hash whatever `rootInvocation` survived step 3; no back-coupling into the step-3 body).
- Pros: Removes ~150 lines; single place for the envelope checks.
- Cons: Creates ONE point where a subtle regression breaks all three money paths at once — only acceptable WITH its own dedicated adversarial test for the shared frame.
- Effort: Medium
- Risk: Medium (money-auth code)

## Recommended Action
Option A — defer extraction to the 4th verb (record the decision now).

## Technical Details
Two reviewers (simplicity) independently rated this a judgment call and recommended deferring the extraction rather than folding it into this PR. If extracted, the shared frame needs its own adversarial golden-vector test in addition to the per-verb step-3 tests.

## Acceptance Criteria
- Decision recorded (extract-now vs extract-on-fourth). If extracted: a dedicated shared-frame adversarial test exists AND the per-verb (bid/cancel) golden vectors still pass.

## Work Log
- 2026-08-20: created from PR #42 code-simplicity-reviewer review (Finding 1)

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/42

---

## Resolution (COMPLETE — 2026-08-20, decision recorded)
Decision: **defer the shared-frame extraction to a 4th escrow-verb verifier** (user-confirmed). Rationale:
`cancel-authorization.ts` is fail-closed money-auth code whose design value is that each verifier reads
top-to-bottom and is independently golden-vector-pinned; the rule-of-three line is reached but the variation
is genuinely only step 3, and extracting now would create ONE point that could break all three money
verifiers at once. If/when a 4th verb (or a change that would touch all three) appears, extract a
`parseAndVerifyAuthFrame(input)` running steps 0-2 → a `pinRootInvocation(...)` step-3 callback → steps 4-6,
AND give the shared frame its own dedicated adversarial golden-vector test in addition to the per-verb tests
(the clean seam: steps 4-6 hash whatever `rootInvocation` survived step 3, so there is no security back-coupling
into the step-3 body). Same applies to the `buildCancelBid`/`submitSignedCancelBid`/`pollForCancel` scaffold
duplication. No code change this ticket. (This resolution also covers the same rule-of-three call-out the
simplicity reviewer made about the relayer build/submit trio.)
