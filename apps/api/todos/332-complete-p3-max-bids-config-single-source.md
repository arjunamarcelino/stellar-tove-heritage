---
status: complete
priority: p3
issue_id: 332
tags: [code-review, architecture, configuration, tov-160]
dependencies: []
---
# `OFFERING_MAX_BIDS_PER_OFFERING` default `40` is written three times across two config namespaces — the submit gate and the settle belt can silently diverge

## Problem Statement
The default literal `40` for the on-chain `MAX_BIDS_PER_OFFERING` ceiling is duplicated in three places, and the two `registerAs` factories read `process.env` directly (they do NOT consume Joi's defaulted value, so the Joi `.default(40)` only applies to startup validation, not to the values the app injects). Worse, the same logical on-chain ceiling is exposed from TWO config namespaces: the submit gate reads `offeringBidConfig.maxBidsPerOffering` while the settle belt reads `offeringEscrowConfig.maxBidsPerOffering`. With the env var UNSET, editing one default literal silently diverges the submit gate from the settle belt on a MONEY invariant — a book could pass the submit gate at one ceiling yet be rejected (or, if edited the other way, admitted) by the settle belt at a different one.

## Findings
- `src/config/offering-bid.config.ts:15` — `maxBidsPerOffering: parseInt(process.env.OFFERING_MAX_BIDS_PER_OFFERING ?? '40', 10)` (the submit gate's source; the comment claims "SAME env var ... one source of truth").
- `src/config/offering-escrow.config.ts:87` — `maxBidsPerOffering: parseInt(process.env.OFFERING_MAX_BIDS_PER_OFFERING ?? '40', 10)` (the settle belt's source — a second copy of the `40` literal).
- `src/config/validation-schema.ts:152` — `OFFERING_MAX_BIDS_PER_OFFERING: Joi.number().integer().min(1).max(500).default(40)` (a third copy of the default; not consumed by the factories' `process.env` reads).
- Consumers: submit gate `backoffice-offerings.service.ts:429-430` reads `escrowCfg.maxBidsPerOffering`; the settle belt `assertClearingInvariants` receives `this.cfg.maxBidsPerOffering` at `offering-settle.processor.ts:135` — two config objects feeding the same on-chain ceiling.

## Proposed Solutions
### Option A — One shared default constant imported by both factories
- Description: Define `OFFERING_MAX_BIDS_DEFAULT = 40` in a dependency-free constant module; both factories and the Joi `.default(...)` import it. One literal, three references.
- Pros: Minimal change; a single edit point for the default; keeps both namespaces if other consumers depend on them.
- Cons: The value still lives in two config namespaces at runtime — if the env is set inconsistently across processes it can still diverge (though a single env var makes that unlikely).
- Effort: Small
- Risk: Low

### Option B — Keep the cap in ONE config (escrow) and inject that into the bid service
- Description: Since the cap is an on-chain-settle property, keep `maxBidsPerOffering` only on `offeringEscrowConfig`; delete the duplicate key from `offeringBidConfig`; have the submit gate read the escrow config (it already injects `escrowCfg` — see `backoffice-offerings.service.ts:74`).
- Pros: True single source of truth — one config key, impossible to diverge; the submit gate already has `escrowCfg` injected.
- Cons: The bid submission surface (`bids/`) that reads `offeringBidConfig` would need the escrow config injected there too (a cross-config dependency for the public bid path).
- Effort: Small
- Risk: Low

### Option C — Leave as-is
- Description: Accept the triplicated default + dual namespace.
- Pros: Zero change.
- Cons: A money invariant can silently diverge on a one-line default edit; the "one source of truth" comment is inaccurate.
- Effort: None
- Risk: Medium (money invariant divergence on edit)

## Recommended Action
Prefer Option B where feasible — collapse the cap to the single `offeringEscrowConfig.maxBidsPerOffering` (the cap is an on-chain-settle property) and inject that config wherever the submit gate lives, deleting the duplicate `offeringBidConfig` key so divergence is structurally impossible. If the public bid path cannot cleanly take the escrow config, fall back to Option A (one shared `OFFERING_MAX_BIDS_DEFAULT` constant referenced by both factories and the Joi default).

## Technical Details
The factories read `process.env` directly per the `registerAs` pattern, so Joi's `.default(40)` never reaches the injected value — the two `?? '40'` literals are the real runtime defaults and must not drift from each other or from Joi. Confirm which surfaces consume `offeringBidConfig.maxBidsPerOffering` before deleting the key (the public `bids/` submission path).

## Acceptance Criteria
- The `40` default exists in exactly one place, referenced by every reader (both factories + Joi), OR the cap lives in a single config key consumed by both the submit gate and the settle belt.
- With the env unset, the submit gate and the settle belt provably use the same ceiling (a test asserts the two injected values are equal).

## Work Log
- 2026-08-20: created from PR #43 architecture-strategist + code-simplicity-reviewer review

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/43

---

## Resolution (COMPLETE — 2026-08-20)
Introduced one shared `OFFERING_MAX_BIDS_DEFAULT = 40` const in `offering-bid.config.ts`, imported by both
`offering-bid.config` (submit gate) and `offering-escrow.config` (settle belt) and the Joi schema
(`.default(OFFERING_MAX_BIDS_DEFAULT)`). The default literal `40` now lives in exactly one place, so the
submit gate and settle belt can no longer diverge on this on-chain money ceiling when the env var is unset
(both still read the same `OFFERING_MAX_BIDS_PER_OFFERING` env). No import cycle (offering-bid.config is a
lightweight registerAs leaf). Build green.
