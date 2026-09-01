---
status: complete
priority: p2
issue_id: 239
tags: [code-review, security, error-handling, information-disclosure, TOV-240, PR-34]
dependencies: [242]
---

# `assertActiveStatus` 500 echoes the internal drifted status value + projection wording in the response body

## Problem Statement
`assertActiveStatus` throws `failHttp(ErrorCode.INTERNAL_ERROR, 500, \`Unexpected non-active contract status "${status}" in active projection\`)`. Because `failHttp` builds an `HttpException`, `AllExceptionsFilter` passes the object-form body through **verbatim** — the generic "Internal server error" masking only fires for *non*-HttpException errors. So a corrupt/drifted `fraction_contracts.status` value is echoed to the client inside a 500, along with internal projection wording. This contradicts the codebase's own "never leak internals on 5xx" convention (`common/CLAUDE.md`). Impact is low: the branch is unreachable-by-construction (the active-only finder filters `status IN ('deploying','deployed')` and the DB `CHK_fc_status` constraint enforces valid values), the input is not attacker-controlled, and the audience is admin-only. It only fires if an at-rest invariant is already broken.

## Findings
Flagged by security-sentinel (P2).
- `src/modules/backoffice/artworks/dto/active-fraction-status.ts:17-21`.
- Reachable from `fraction-contract-summary.dto.ts:15` and `fraction-contract-detail.dto.ts:44`.
- `AllExceptionsFilter` verbatim-passes HttpException bodies (generic masking is non-HttpException only).
- **Interacts with #242:** if the guard is removed/inlined per the simplicity finding, re-evaluate this.

## Proposed Solutions
1. **Throw a generic-message 500** (e.g. `'Internal server error'`) and `logger.error` the offending status server-side. Effort: Small. Risk: none. Keeps the fail-loud behavior without the disclosure.
2. Keep the descriptive message but ensure the filter masks it (would require filter changes — larger blast radius, not worth it).
3. Accept as-is (admin-only, unreachable branch). Risk: minor convention violation.

## Recommended Action
**RESOLVED** (Solution 1). `assertActiveStatus` now `logger.error(...)`s the offending status server-side and throws a **generic** `'Internal server error'` 500 body — the drifted internal DB value is never echoed to the client. (In the relocated `constants/active-fraction-status.ts` from #242.)

## Technical Details
- Affected: `src/modules/backoffice/artworks/dto/active-fraction-status.ts`. Log the status server-side for diagnosability; return a generic body.

## Acceptance Criteria
- [ ] A forced-drift unit test asserts the 500 body carries no raw status value / internal wording.
- [ ] The offending value is logged server-side.

## Work Log
- 2026-07-18: created from PR #34 review (security-sentinel).
- 2026-07-18: RESOLVED — generic 500 body + server-side log; unit test asserts the body carries no raw status value. Build + lint clean; 9 unit tests green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/34
- Convention: `src/common/CLAUDE.md` (never leak internals on 5xx)
