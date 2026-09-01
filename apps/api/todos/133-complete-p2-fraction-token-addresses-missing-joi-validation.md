---
status: complete
priority: p2
issue_id: 133
tags: [code-review, configuration, security, export, TOV-40]
dependencies: [129]
---

# RELAYER_FRACTION_TOKEN_ADDRESSES not in the Joi schema or .env.example

## Problem Statement
`relayer.config.ts` reads a new env var `RELAYER_FRACTION_TOKEN_ADDRESSES` that drives real money movement (it builds the per-token drain list). The config CLAUDE.md mandates adding every env var to `validation-schema.ts` (Joi) so a malformed value fails fast at boot. Every other relayer var is in the schema; this one is not, so a malformed value (e.g. a non-C-StrKey) is not caught at startup and only surfaces as a runtime relayer failure mid-export. It is also absent from `.env.example`, making it undiscoverable to operators.

## Findings
- `src/config/relayer.config.ts:39` — consumes `process.env.RELAYER_FRACTION_TOKEN_ADDRESSES`.
- `src/config/validation-schema.ts` (relayer block) — var absent.
- `.env.example` (relayer block) — var absent.
- `wallet-export.service.ts` builds the drain token list from it.

## Proposed Solutions

### Option A: Add to Joi schema + .env.example
- **Description:** `RELAYER_FRACTION_TOKEN_ADDRESSES: Joi.string().allow('').default('')`, optionally with a comma-separated C-StrKey `.pattern(...)`. Document a line in `.env.example` under the TOV-40 block.
- **Pros:** Fail-fast at boot; discoverable; matches the config convention.
- **Cons:** None material.
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A — add Joi validation + `.env.example` (confirmed). Note: [[129]] renamed the var to
`RELAYER_FRACTION_TOKENS` (address:symbol:decimals triples), so validation targets the new name.

## Implemented Solution
Added `RELAYER_FRACTION_TOKENS` to the Joi schema: `Joi.string().allow('').pattern(...)` where the
pattern enforces comma-separated `<56-char C-StrKey base32>[:symbol[:decimals]]` triples (decimals 1-2
digits), so a malformed address/format fails at boot rather than mid-export. Documented the var in
`.env.example` under the relayer block with an example and a note that it is empty until fraction tokens
exist.

## Technical Details
Affected: `src/config/validation-schema.ts` (new `RELAYER_FRACTION_TOKENS` rule), `.env.example`.
Verified the export e2e (which boots AppModule with the Joi schema) accepts the test triple.

## Acceptance Criteria
- [x] A malformed `RELAYER_FRACTION_TOKENS` fails at boot (Joi).
- [x] The var is documented in `.env.example`.

## Work Log
- 2026-07-14: Filed from PR #25 review (pattern-recognition reviewer).
- 2026-07-15: Added Joi rule + .env.example for `RELAYER_FRACTION_TOKENS` (renamed in [[129]]). build + lint + export e2e green. Marked complete.
