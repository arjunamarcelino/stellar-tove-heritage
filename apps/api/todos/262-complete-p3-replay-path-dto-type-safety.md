---
status: complete
priority: p3
issue_id: 262
tags: [code-review, typescript, quality, TOV-152, PR-36]
dependencies: []
---

# Idempotency replay returns a plain object cast as `OfferingResponseDto` (type lie, latent)

## Problem Statement
On the replay path, `return begin.body as OfferingResponseDto;` — but `begin.body` is `JSON.parse` output from the idempotency store (a plain object), not an `OfferingResponseDto` instance. The `as` cast asserts a runtime type that isn't there. Harmless today (the response is plain-JSON-serialized with no class transform), but it becomes a real defect if a `ClassSerializerInterceptor` with `excludeExtraneousValues: true` is ever added globally — it would silently strip every field on the replay path (the DTO has no `@Expose`) while the fresh path works, a divergence a naive first-request test wouldn't catch.

## Findings
Flagged by **kieran-typescript-reviewer (P3)**.
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts` — replay branch (`begin.outcome === 'replay'`).
- `src/common/idempotency/idempotency-store.ts` — `begin()` returns `body: JSON.parse(...)`.

## Proposed Solutions
1. **Accept + comment** — leave the cast, add a comment noting the serialization assumption (fresh and replay both go straight to JSON). Effort: trivial. Matches the fractionalize sibling, which does the same cast.
2. **Reconstruct** via `OfferingResponseDto.fromPlain(body)` / `plainToInstance` so fresh and replay return the same runtime type. Effort: Small. More robust if class-based serialization is ever introduced.

## Recommended Action
**RESOLVED — Solution 1 (accept + comment).** Added a comment at the replay return documenting that
`begin.body` is a plain JSON object, safe to return directly because responses are plain-JSON serialized
(no class transform), with an explicit note to reconstruct via `fromPlain`/`plainToInstance` if a
`ClassSerializerInterceptor` is ever added globally. Matches the fractionalize sibling's cast.

## Technical Details
- `src/modules/backoffice/offerings/backoffice-offerings.service.ts`.

## Acceptance Criteria
- [x] A comment documents the plain-JSON assumption + the interceptor caveat at the replay return.

## Work Log
- 2026-08-18: created from PR #36 review (kieran-typescript-reviewer P3).
- 2026-08-18: RESOLVED — comment added at the replay return (`backoffice-offerings.service.ts`). Build + lint green.

## Resources
- PR https://github.com/Tove-Heritage/tove-be/pull/36
