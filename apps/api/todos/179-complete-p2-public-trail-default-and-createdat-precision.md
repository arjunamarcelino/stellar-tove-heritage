---
status: complete
priority: p2
issue_id: 179
tags: [code-review, security, privacy, TOV-27]
dependencies: []
---

## Resolution (complete — 2026-07-15, per product decision)
Product decision (confirmed): keep the public rename trail + default-true opt-out (per the AC), and reduce
the `createdAt` fingerprint by exposing DATE granularity only. `CollectorsService` now returns
`user.createdAt.toISOString().slice(0, 10)` (UTC `YYYY-MM-DD`) instead of a millisecond ISO timestamp; the DTO
`@ApiProperty` is `format: 'date'` with a member-since-date description. Updated the unit test (exact
`'2026-01-15'`) and the e2e `createdAt` regex (`^\d{4}-\d{2}-\d{2}$`). The trail itself stays public-by-default
with the existing per-user opt-out (`handle_history_public`); the standing follow-ups (product/privacy
sign-off on public-by-default, TOV-44 change-time warning, anti-scraping) remain tracked outside this todo.
Build clean; collectors unit (9) + e2e (9) green.

# Public rename trail defaults to visible + ms-precision createdAt (deanonymization/scraping)

## Problem Statement
`GET /collectors/:handle` is public and returns the full deduped rename trail plus a millisecond-precision
`createdAt` for any resolvable handle. `handle_history_public` defaults TRUE, so every collector is opted
into publishing their rename history unless they act. The trail links a current pseudonym to all prior ones
(deanonymization); `createdAt` ms is a signup-time oracle/fingerprint; the 30/min/IP throttle doesn't stop
botnet/IP-rotation scraping of the handle graph. (Overlaps the plan's deferred "product/privacy sign-off" item.)

## Findings
- `src/modules/collectors/collectors.controller.ts:20` — `@Public()` 30/min.
- `src/modules/collectors/dto/collector-profile-response.dto.ts:20-25` + `collectors.service.ts:41` — ms-precision `createdAt`.

## Proposed Solutions
### Option A: Default `handle_history_public` to FALSE (opt-in)
- **Pros:** safest for pseudonymity. **Cons:** deviates from current AC; needs product coordination. **Effort: Small + product coordination.**

### Option B: Keep default true but reduce exposure
- **Pros:** truncate `createdAt` to date granularity on the public surface + tighten throttle / add anti-scraping. **Cons:** default-on trail still links pseudonyms. **Effort: Small.**

### Option C: Keep as-is
- **Pros:** no code change. **Cons:** carries deanonymization/scraping risk. **Effort: None** (record explicit product/privacy sign-off + a TOV-44 change-time warning).

## Recommended Action
_(triage — needs product/privacy sign-off; this is a product decision, not purely technical.)_

## Technical Details
- Files: `collectors.service.ts`, `collector-profile-response.dto.ts`, migration default (if opt-in).

## Acceptance Criteria
- [x] Decision recorded (keep public trail + default-true opt-out; truncate `createdAt` to date); `createdAt` now date-granularity + tests updated.

## Work Log
- 2026-07-15: Filed from `/workflows:review` of PR #29 (security-sentinel).

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/29
