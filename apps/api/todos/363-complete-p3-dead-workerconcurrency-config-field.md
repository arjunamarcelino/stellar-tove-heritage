---
status: complete
priority: p3
issue_id: 363
tags: [code-review, cleanup, config, tov-174, pr-47]
dependencies: []
---
# Dead config field: `rfqFanoutConfig.workerConcurrency` is never consumed (PR #47)

## Problem Statement
`rfqFanoutConfig` exposes `workerConcurrency`, but nothing injects it. The only consumer — the `@Processor`
decorator — is evaluated **pre-DI**, so it reads `process.env.RFQ_FANOUT_WORKER_CONCURRENCY` directly. The
default `5` now lives in three places (Joi schema, config factory, decorator), and the config copy is dead
weight that reads as the source of truth: a maintainer who edits the config field expecting the worker to
follow will be silently wrong.

## Findings
Source: kieran-typescript-reviewer (#1), code-simplicity-reviewer (#6), pattern-recognition-specialist (LOW)
— triple-confirmed (grep-confirmed no injection site).
- `src/config/rfq-fanout.config.ts:18` — the unused field.
- `src/modules/marketplace/notifications/fanout/rfq-fanout.processor.ts:14-18` — reads `process.env` directly (documented pre-DI bypass).
- `src/config/validation-schema.ts:174` — the Joi entry (KEEP — it validates the env var the decorator reads).

## Proposed Solutions
### Option A — Delete the field from the factory (Recommended)
- Description: Remove `workerConcurrency` from `rfqFanoutConfig`; keep the Joi entry.
- Pros: Removes the dead/misleading duplication; one clear source (the env var, validated by Joi).
- Cons: None.
- Effort: Small · Risk: None
### Option B — Keep it with an explanatory comment
- Description: Leave the field but annotate `// NOT injected — @Processor reads process.env at decoration (pre-DI)`.
- Pros: Config symmetry.
- Cons: Still two "sources"; comment can rot.
- Effort: Small · Risk: Low

## Recommended Action
Option A — delete the field; keep the Joi entry.

## Resolution (2026-08-21, complete)
Removed `workerConcurrency` from `rfqFanoutConfig` and replaced it with a NOTE comment explaining that the
`@Processor` decorator reads `RFQ_FANOUT_WORKER_CONCURRENCY` from `process.env` directly at decoration (pre-DI),
so a config field would be dead weight. The Joi entry (`validation-schema.ts:174`) stays — it validates the env
var the decorator actually reads. Grep confirms no remaining `workerConcurrency` reference. File:
`rfq-fanout.config.ts`. tsc clean.

## Acceptance Criteria
- [ ] No dead/duplicated concurrency source; the env var remains Joi-validated and is what the worker uses.

## Work Log
- 2026-08-21: Filed from PR #47 review (typescript + simplicity + pattern).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/47
