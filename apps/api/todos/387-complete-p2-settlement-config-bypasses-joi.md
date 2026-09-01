---
status: complete
priority: p2
issue_id: 387
tags: [code-review, tov-177, pr-49, config, reliability, consistency]
dependencies: []
---
# New `MARKETPLACE_SETTLEMENT_*` config knobs bypass Joi validation (fail-late instead of fail-fast)

## Problem Statement
`marketplace-settlement.config.ts` reads seven `MARKETPLACE_SETTLEMENT_*` env vars (RPC URL, network passphrase,
`READ_TIMEOUT_MS`, `ACCEPT_SIG_LEDGERS`, and the four reconcile knobs) via `parseInt` / string reads, but only
`FRACTION_MARKETPLACE_SETTLER_ADDRESS` has an entry in `validation-schema.ts`. The codebase convention
(`config/CLAUDE.md`; sibling `offering-escrow.config` etc.) is that every `registerAs` config pairs `parseInt`
with a Joi guard so a bad value fails **at boot**. Here a non-numeric override yields `NaN` for
`acceptSigValidityLedgers` / `readTimeoutMs` and fails at **runtime** on the money path (the sig-validity ledger
window and the read timeout are both live-used), rather than refusing to start.

Flagged by architecture (P3) and typescript (P3); filed **P2** because two of the affected knobs
(`acceptSigValidityLedgers`, `readTimeoutMs`) are on the live accept/settle path and `NaN` there is a
silent-mis-signing / hung-read risk, not a cosmetic gap.

## Findings
- `src/config/marketplace-settlement.config.ts:24-36` — `parseInt(process.env.MARKETPLACE_SETTLEMENT_*)` with
  `??` defaults, no schema.
- `src/config/validation-schema.ts` — only `FRACTION_MARKETPLACE_SETTLER_ADDRESS` present.
- `.env.example` — the new vars are undocumented (config uses `??` defaults so unset is safe, but operators have
  no reference).

## Proposed Solutions
### Option A — Add Joi entries for all `MARKETPLACE_SETTLEMENT_*` vars + document in `.env.example` (Recommended)
- Numbers: `Joi.number().integer().positive()` with the same defaults; strings: `Joi.string().uri()` for the RPC
  URL, allowed-values for the passphrase. Mirror `offering-escrow.config`'s schema block.
- Pros: fail-fast at boot, matches convention. Cons: none. Effort: Small · Risk: None.

### Option B — Only validate the live-path knobs now
- Validate `READ_TIMEOUT_MS` + `ACCEPT_SIG_LEDGERS` (+ the settler address already done); defer the reconcile
  knobs until [[382-pending-p1-settle-reconcile-backstop-missing]] lands (or delete them with 382 Option B).
- Effort: Small · Risk: Low.

## Recommended Action
Option A (or B if the reconcile knobs are being removed per 382).

## Technical Details
- Affected: `validation-schema.ts`, `marketplace-settlement.config.ts` (only if aligning defaults),
  `.env.example`. Coordinate with 382 (reconcile knobs) and 386 (new settlement account/secret).

## Acceptance Criteria
- [ ] A non-numeric `MARKETPLACE_SETTLEMENT_ACCEPT_SIG_LEDGERS` / `_READ_TIMEOUT_MS` fails at boot, not runtime.
- [ ] All shipped `MARKETPLACE_SETTLEMENT_*` vars appear in `.env.example` with sane defaults.

## Resolution (2026-08-22, complete — Option A)
Added Joi entries for every `MARKETPLACE_SETTLEMENT_*` var (RPC/passphrase optional with the config's RELAYER_*
fallback; `READ_TIMEOUT_MS`/`ACCEPT_SIG_LEDGERS`/`SETTLE_GRACE_MS`/`RECONCILE_GRACE_MS`/`RECONCILE_BATCH` as
bounded integers; `RECONCILE_ENABLED` as `valid('true','false')`; `RECONCILE_CRON` a string) so a non-numeric
override fails **at boot**, not as `NaN` on the live accept/settle path. Also validated the new (optional)
`RELAYER_MARKETPLACE_SETTLEMENT_SECRET` (#386) as a Stellar secret seed or empty, and documented all vars in
`.env.example` with defaults. Followed the established schema idioms (string `valid('true','false')` for
booleans so the config's `=== 'true'` still works; `Joi.number().integer().min().max().default()` for knobs).

Verified: build 0, lint clean, e2e boot smoke (rfq-detail 7/7) — AppModule applies the schema at boot with the
new rules and the test env still validates (all new vars default/optional).

### Files changed
- `src/config/validation-schema.ts` (10 new entries), `.env.example` (documented block)

## Work Log
- 2026-08-22: Filed from PR #49 review (architecture + typescript).
- 2026-08-22: Added Joi rules + `.env.example`; boot-validated; marked complete.
