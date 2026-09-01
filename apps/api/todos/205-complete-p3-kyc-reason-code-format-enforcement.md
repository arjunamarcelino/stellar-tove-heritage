---
status: complete
priority: p3
issue_id: 205
tags: [code-review, security, kyc, TOV-29, PR-31, future-ticket]
dependencies: []
---

# `reason` is documented as a machine-readable code but nothing enforces it; read-side is the only guardrail

## Problem Statement
`kyc_reason` and the DTO `reason` field are documented (TOV-29 R3) as holding a **machine-readable code**
(e.g. `frozen_compliance_review`), never raw admin prose — the security posture that keeps internal
freeze/removal justifications from reaching the collector. But nothing in this PR enforces the code shape:
`varchar(256)` is generous enough for a free-text sentence, there is no CHECK/regex, and
`WhitelistStatusResponseDto.build` passes `user.kycReason` straight through for frozen/removed. The M12
writer isn't in this PR, so the **read side is the sole guardrail and it does none**. If M12 (or a manual
write) ever stuffs prose here, this endpoint discloses it verbatim to the collector. Also, the Swagger
schema under-specifies the field.

## Findings
- `src/modules/users/entities/user.entity.ts:56-59` — `kyc_reason varchar(256)`, comment says "NEVER raw admin prose" but no enforcement. (security P3, data-integrity P3.)
- `src/modules/kyc/dto/whitelist-status-response.dto.ts:52` — `dto.reason = gate.reason ? user.kycReason : null;` no format validation on read. (security P3.)
- `src/modules/kyc/dto/whitelist-status-response.dto.ts:34-39` — `reason` `@ApiProperty` has no `example`/`enum`; consumers localizing the code get no value space from the spec. (kieran-typescript P3.)

## Proposed Solutions
### Option A (recommended): validate the code shape on read (defense-in-depth now)
`dto.reason = gate.reason && /^[a-z0-9_]+$/.test(user.kycReason ?? '') ? user.kycReason : null;` — a
non-code value degrades to `null` rather than leaking prose. Add `example: 'frozen_compliance_review'`
to the `@ApiProperty`. **Effort: Small.**

### Option B: enforce at the write boundary in M12
Introduce a `KycReasonCode` enum + a CHECK constraint (or DB enum-of-codes) when the M12 transition
writer lands; tighten the column toward a realistic cap (e.g. 64). This is the durable fix but belongs to
M12. **Effort: Medium (M12).**

## Recommended Action
**RESOLVED (Option A — read-side guard).** `WhitelistStatusResponseDto.build` now surfaces `reason` only
when it matches `^[a-z0-9_]+$` (a lowercase snake_case code); a mis-written prose value degrades to `null`
instead of leaking to the collector. Added `example: 'frozen_compliance_review'` to the `@ApiProperty`, and a
unit test asserting a prose reason (`'Suspected sanctions match, case #4471'`) yields `reason: null`. Option B
(durable `KycReasonCode` enum + CHECK at the write boundary) remains carried into the M12 transition ticket /
the reason-code follow-up already flagged to TOV-45.

## Technical Details
- Affected now: `whitelist-status-response.dto.ts`. Affected at M12: the write path + a CHECK/enum on `kyc_reason`.

## Acceptance Criteria
- [ ] The read path cannot surface a non-code `reason` value (validated on read, or enforced at write in M12).
- [ ] The `reason` `@ApiProperty` documents its value space (`example` and/or `enum`).

## Work Log
- 2026-07-17: Filed from PR #31 review (security-sentinel P3, data-integrity P3, kieran-typescript P3). No code changed.
- 2026-07-17: RESOLVED (read-side). `whitelist-status-response.dto.ts` code-shape guard + `@ApiProperty` example + prose-reason unit test. M12 write-boundary enforcement deferred to that ticket. build/lint/unit green. Status → complete.
