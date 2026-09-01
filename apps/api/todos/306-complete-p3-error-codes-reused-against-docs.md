---
status: complete
priority: p3
issue_id: 306
tags: [code-review, api-design]
dependencies: []
---
# Two BID_* error codes are reused with meanings that contradict their enum docs

## Problem Statement
`BID_COUNT_EXCEEDS_FLOAT` (documented "count > public_float") is thrown when the escrow COST exceeds `cfg.maxBidCostStroops` (a per-bid ceiling breach); `BID_ABOVE_HIGH_PRICE` (documented "price > band high") is thrown for a `computeEscrowStroops` overflow. A client hitting the cost ceiling is wrongly told their count exceeds the float. There's no dedicated code for the cost-ceiling/overflow case (unlike the well-scoped `BID_INSUFFICIENT_BALANCE`).

## Findings
- `src/modules/offerings/bids/offering-bids.service.ts:271-272` — cost-ceiling → `BID_COUNT_EXCEEDS_FLOAT`.
- `src/modules/offerings/bids/offering-bids.service.ts:268-269` — overflow → `BID_ABOVE_HIGH_PRICE`.
- `src/common/enums/error-code.enum.ts` — the two codes' documented meanings.

## Proposed Solutions
### Option A — Add a dedicated cost-ceiling code
- Description: Add `BID_COST_EXCEEDS_LIMIT` (422) and map both the cost-ceiling and overflow cases to it.
- Pros: Wire contract matches documented meaning; client can distinguish "too expensive per-bid" from "count > float" and "price > band"; mirrors the well-scoped `BID_INSUFFICIENT_BALANCE`.
- Cons: New enum value + contract-doc update + any client mapping.
- Effort: Small
- Risk: Low

### Option B — Reword the enum docs to cover the reuse
- Description: Broaden the documented meanings of the two existing codes so the reuse is no longer contradictory.
- Pros: No new code path; minimal change.
- Cons: Weaker — keeps an ambiguous wire contract where one code spans multiple distinct failure causes.
- Effort: Small
- Risk: Low

## Recommended Action

## Technical Details
The cost-ceiling and overflow branches are distinct failure causes (per-bid cost limit / arithmetic overflow) that currently borrow codes whose documented semantics describe unrelated conditions (float and band-high). A dedicated code keeps the client-facing contract honest.

## Acceptance Criteria
- The cost-ceiling / overflow failures return a code whose documented meaning matches.
- The API contract doc is updated to reflect the code.

## Work Log
- 2026-08-20: created from PR #41 multi-agent review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/41

---

## Resolution (COMPLETE — 2026-08-20)

Added `BID_COST_EXCEEDS_LIMIT` (422) and mapped both the per-bid cost-ceiling breach and the
`computeEscrowStroops` overflow to it (previously `BID_COUNT_EXCEEDS_FLOAT` and `BID_ABOVE_HIGH_PRICE`
respectively, whose documented meanings didn't match). Now every `BID_*` code's wire meaning matches its
enum doc. Service unit test + contract doc error table updated. Build green; service unit 20/20.
