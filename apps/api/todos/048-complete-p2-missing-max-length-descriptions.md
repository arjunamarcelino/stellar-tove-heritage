---
status: complete
priority: p2
issue_id: "048"
tags: [code-review, security, validation]
dependencies: []
---

# Missing @MaxLength on Stage/Mission Description Fields

## Problem Statement

Create/Update DTOs for stages and missions accept `description` as a string but have no `@MaxLength()` constraint. A user could submit arbitrarily large text, causing database bloat or DoS.

## Findings

- `src/modules/backoffice/stages/dto/create-stage.dto.ts` — `description` has `@IsString()` but no `@MaxLength()`
- `src/modules/backoffice/missions/dto/create-mission.dto.ts` — same issue
- Title fields already have `@MaxLength(255)` — descriptions should have a reasonable limit too
- DB columns are `text` type (unlimited) — validation must happen at application level
- Identified by: security-sentinel (LOW)

## Proposed Solutions

### Option 1: Add @MaxLength(2000) to descriptions (Recommended)

**Approach:** Add `@MaxLength(2000)` decorator to description fields in create and update DTOs.

**Effort:** Small | **Risk:** Low

## Technical Details

**Affected files:**
- `src/modules/backoffice/stages/dto/create-stage.dto.ts`
- `src/modules/backoffice/missions/dto/create-mission.dto.ts`
- Update DTOs inherit via `PartialType`, so they get the constraint automatically

## Acceptance Criteria

- [ ] Description fields have `@MaxLength()` constraint
- [ ] Excessively long descriptions return 400 Bad Request

## Work Log

### 2026-06-01 - Initial Discovery

**By:** Claude Code (PR #5 review)
