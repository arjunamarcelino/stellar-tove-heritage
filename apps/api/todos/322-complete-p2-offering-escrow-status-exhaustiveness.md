---
status: complete
priority: p2
issue_id: 322
tags: [code-review, typescript, tov-160]
dependencies: []
---
# Settle processor handles `OfferingEscrowStatus` with a non-exhaustive if-ladder — a new variant silently routes to "settle it"

## Problem Statement
`OfferingSettleProcessor.process` branches on the `OfferingEscrowStatus` union (`'open' | 'closed' | 'settled' | 'cancelled' | 'unknown'`) with an if-ladder rather than an exhaustive `switch`. The ladder explicitly handles `cancelled` (throw terminal), `unknown` (throw retryable), `settled` (adopt), and `open` (close-then-settle) — but `closed` is the UNWRITTEN fall-through: it is never named, it just proceeds to compute the clearing and call `close_and_settle`. That is correct for `closed` today, but it means any 6th status added to the union in `offering-escrow.service.interface.ts` (e.g. a future `paused`/`disputed`) would ALSO fall through the same unhandled path and get **settled** — a silent mint on the money leg, with no compiler complaint.

## Findings
- `src/modules/offerings/settle/offering-settle.processor.ts:97-124` — the if-ladder: `if (status === 'cancelled') throw…`, `if (status === 'unknown') throw…`, then `let adopted = status === 'settled'`, then `if (!adopted) { if (status === 'open') {closeOffering…} … }`. `closed` is never mentioned; it reaches the settle path by falling through every guard.
- `src/modules/offerings/escrow/offering-escrow.service.interface.ts:38` — `export type OfferingEscrowStatus = 'open' | 'closed' | 'settled' | 'cancelled' | 'unknown';`. Adding a member here is a one-line change that would NOT surface any error at the processor call site.
- The settle path that a fall-through reaches is `computeClearing` + `assertClearingInvariants` + `escrow.closeAndSettle(...)` (lines 126-156) — the actual money mint + refund-all.

## Proposed Solutions
### Option A — Convert to `switch (status)` with `default: assertNever(status)`
- Description: Replace the if-ladder with `switch (status)` carrying an explicit `case 'closed':` (proceed to settle) alongside `open`/`settled`/`cancelled`/`unknown`, and a `default:` that calls a shared `assertNever(x: never): never` exhaustiveness helper (throw + `never` return type). Adding a 6th union member then fails to compile at the `default` until the author decides its handling.
- Pros: A new status becomes a COMPILE error at the exact money site, not a runtime settlement; `closed` becomes self-documenting instead of an implicit fall-through; the control flow reads as a state machine.
- Cons: Slightly more verbose than the ladder; needs a tiny `assertNever` util if one does not already exist in `@common`.
- Effort: Small
- Risk: Low

### Option B — Keep the ladder, add an explicit `closed` guard + a trailing exhaustiveness throw
- Description: Leave the if-ladder but add `if (status === 'closed') { /* proceed */ }` and, after all branches, a `throw new Error(\`unhandled escrow status: ${status satisfies never}\`)` (or an `assertNever` call) so the union is still statically closed.
- Pros: Smaller diff than a full switch rewrite; still gets the compile-time exhaustiveness guard.
- Cons: The ladder-with-a-satisfies-never at the end is less readable than a switch; the `adopted`/`open` sequencing still reads as imperative rather than per-case.
- Effort: Small
- Risk: Low

## Recommended Action
Option A — convert the status handling to a `switch (status)` with an explicit `case 'closed'` and a `default: assertNever(status)` (or an equivalent thrown exhaustiveness guard), so any future addition to `OfferingEscrowStatus` is a compile error at the settle site rather than a silent route down the mint path.

## Technical Details
The order-sensitive logic (`adopted = status === 'settled'`, close-before-settle only when `open`, the post-close in-flight re-check) must be preserved when restructuring — `closed` and `open` both continue to the shared clearing/settle block, they differ only in whether `closeOffering` runs first. `assertNever` should throw (defensive at runtime) in addition to having a `never` parameter, so an unexpected runtime value (e.g. a downstream contract returning an unmodeled string) fails loudly rather than falling through. This is a compile-safety hardening only — no behavioral change for the current five statuses.

## Acceptance Criteria
- The status handling is a `switch` (or ladder + trailing `satisfies never`/`assertNever`) that is statically exhaustive over `OfferingEscrowStatus`.
- `closed` is handled by a named branch, not an implicit fall-through.
- Adding a 6th member to `OfferingEscrowStatus` produces a TypeScript compile error at the settle processor until it is explicitly handled (demonstrable by a temporary local edit during review).
- No behavioral change for the existing five statuses (existing settle unit/integration suites stay green).

## Work Log
- 2026-08-20: created from PR #43 [kieran-typescript-reviewer] review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
Converted the settle worker's self-heal status handling from an if-ladder (with an implicit `closed`
fall-through) to an exhaustive `switch (status)` over `OfferingEscrowStatus` with a `default: assertNever(status)`
compile-time guard. Every variant is now handled explicitly: `settled` → adopt, `open` → close + recordClosed
+ assertBookFinal, `closed` → assertBookFinal, `cancelled` → terminal, `unknown` → retryable. Adding a 6th
Status variant to the union is now a BUILD error (via the `never` param) rather than a silent route into the
mint path. Extracted `assertBookFinal()` (the in-flight re-check, shared by open/closed) and `recordClosed()`
helpers, and a module-level `assertNever`. Build green; processor spec 6/6.
