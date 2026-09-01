---
status: complete
priority: p2
issue_id: 245
tags: [code-review, quality, architecture, TOV-237, PR-35]
dependencies: []
---

# `maxContracts` is named/commented a "hard cap" but only logs — it never caps

## Problem Statement
`FRACTION_READ_MAX_CONTRACTS` and the service branch imply a safety limit on the RPC fan-out, but the code only `logger.warn`s and then reads **all** deployed contracts. The name/comment promise a guarantee the code does not provide — the kind of drift that misleads during an incident.

## Findings
Consensus finding: architecture-strategist (P2), performance-oracle (P3.1), kieran-typescript-reviewer (P2.3), code-simplicity-reviewer (P2-2).
- `src/modules/fractionalization/me/me-holdings.service.ts:59-64` — warns when `deployed.length >= maxContracts`, then `buildHoldings` runs on the full array.
- `src/config/fraction-read.config.ts:27-28` — comment: "Hard cap on contracts read per request"; it is a soft warn threshold.
- `findAllDeployed()` has no SQL `LIMIT`.

## Proposed Solutions
1. Rename to `fanOutWarnThreshold` (config + env `FRACTION_READ_FANOUT_WARN`) and fix the comment to "warn-only; fan-out is never truncated." Effort: Small. Risk: none. Keeps the observability intent honest.
2. Enforce a real cap: fail-fast with 503 (or a documented degraded response) when exceeded, since truncating would silently drop holdings and mis-gate a Sell. Effort: Small–Medium. Risk: turns a large catalog into a hard failure — needs product sign-off.
3. Drop the knob entirely for MVP (YAGNI — it never fires at current scale). Effort: Small.

## Recommended Action
**RESOLVED — Solution 1 (user-confirmed).** Renamed the config field `maxContracts` → `fanOutWarnThreshold`, env var `FRACTION_READ_MAX_CONTRACTS` → `FRACTION_READ_FANOUT_WARN`, and rewrote the comment + log message to say "warn threshold" and "does NOT cap the read." The observability signal is kept; the misleading "hard cap" language is gone. Truncation was rejected (would drop holdings → wrong Sell gate).

## Technical Details
- `src/config/fraction-read.config.ts`, `src/config/validation-schema.ts`, `src/modules/fractionalization/me/me-holdings.service.ts:59-66`, `.env.example`, and the two me-holdings specs' cfg objects.

## Acceptance Criteria
- [x] Config field name + comment + log message match actual behavior.
- [x] No implication of a cap that isn't enforced.

## Work Log
- 2026-07-18: created from PR #35 review (architecture, performance, typescript, simplicity — 4-agent consensus).
- 2026-07-18: RESOLVED — renamed to `fanOutWarnThreshold` / `FRACTION_READ_FANOUT_WARN`; build + 34 holdings tests green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/35
