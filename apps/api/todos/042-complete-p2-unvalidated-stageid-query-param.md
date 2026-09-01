---
status: complete
priority: p2
issue_id: "042"
tags: [code-review, security, validation]
dependencies: []
---

# Unvalidated stageId Query Param in MissionsController

## Problem Statement

`BackofficeMissionsController.findAll()` accepts a `stageId` query parameter but does not validate it as a UUID. A malformed value passes through to the database query, which could cause unexpected TypeORM errors or confusing error messages.

## Findings

- `src/modules/backoffice/missions/missions.controller.ts` — `@Query('stageId') stageId?: string` has no validation pipe
- Other UUID params in the codebase use `@Param('id', ParseUUIDPipe)` for path params
- Query params need `@IsUUID()` from class-validator on a DTO, or manual `ParseUUIDPipe`
- Identified by: security-sentinel (MEDIUM), data-integrity-guardian (LOW)

## Proposed Solutions

### Option 1: Add IsUUID validation via query DTO (Recommended)

**Approach:** Create or update a query DTO with `@IsUUID() @IsOptional() stageId?: string` and use `@Query() dto: MissionQueryDto`.

**Pros:**
- Follows NestJS validation best practices
- Reusable DTO
- Swagger auto-documentation

**Cons:**
- New DTO class

**Effort:** Small

**Risk:** Low

## Technical Details

**Affected files:**
- `src/modules/backoffice/missions/missions.controller.ts` — update `@Query` usage
- `src/modules/backoffice/missions/dto/` — new query DTO or add to existing

## Resources

- **PR:** #5

## Acceptance Criteria

- [ ] stageId query parameter is validated as UUID
- [ ] Invalid UUIDs return 400 Bad Request
- [ ] Swagger docs show the parameter type correctly

## Work Log

### 2026-06-01 - Initial Discovery

**By:** Claude Code (PR #5 review)
