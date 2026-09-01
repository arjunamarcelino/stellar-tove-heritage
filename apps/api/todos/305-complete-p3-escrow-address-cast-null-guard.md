---
status: complete
priority: p3
issue_id: 305
tags: [code-review, typescript, correctness]
dependencies: []
---
# offering.escrowContractAddress `as string` cast is decoupled from its null-guard (money-routing field)

## Problem Statement
The escrow contract address (where USDC is escrowed) is force-cast `as string` in three places; the non-null guarantee lives remotely in `assertBiddable` (throws on `!offering.escrowContractAddress`). The compiler can't see it, so the cast silently masks null if that guard is weakened/reordered — on a money-routing field.

## Findings
- `src/modules/offerings/bids/offering-bids.service.ts:87, 104, 187` — `offering.escrowContractAddress as string`.
- Guard at `src/modules/offerings/bids/offering-bids.service.ts:237` (`|| !offering.escrowContractAddress` → throw `OFFERING_NOT_OPEN`).

## Proposed Solutions
### Option A — Return the proven-non-null value from `assertBiddable`
- Description: Change `assertBiddable` to return `Promise<{ offering; escrowContract: string; escrowStroops }>`, and consume `escrowContract` at the three sites. The three casts disappear and the non-null guarantee travels with the value.
- Pros: Compiler-guaranteed non-null at every use site; the guarantee is co-located with the value; no `as` cast on a money field.
- Cons: Small signature change + touch three call sites.
- Effort: Small
- Risk: Low

### Option B — Keep casts but add a local assertion/invariant helper
- Description: Keep the current shape but replace the raw casts with a local `assertNonNull(...)` / invariant helper that throws if null at the use site.
- Pros: Minimal restructuring; makes the invariant explicit at use.
- Cons: Still a runtime check per site rather than a single compiler-level guarantee; more verbose.
- Effort: Small
- Risk: Low

## Recommended Action

## Technical Details
`assertBiddable` already proves `escrowContractAddress` non-null (line 237). Threading that proven value out as a typed non-nullable field is the cleanest way to make the guarantee follow the data instead of relying on a remote throw the compiler cannot see.

## Acceptance Criteria
- No `as string` cast on `escrowContractAddress`.
- The non-null value is compiler-guaranteed at every use site.

## Work Log
- 2026-08-20: created from PR #41 multi-agent review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/41

---

## Resolution (COMPLETE — 2026-08-20)

`assertBiddable` now returns the proven-non-null `escrowContract` (narrowed after its
`!offering.escrowContractAddress` guard) alongside `escrowStroops`. `prepare` and `submit` consume
`escrowContract` (a `string`) directly, so all three `offering.escrowContractAddress as string` casts on
this money-routing field are gone — the non-null guarantee travels with the value and is compiler-checked at
every use site. Build + lint clean; service unit 20/20; e2e 7/7.
