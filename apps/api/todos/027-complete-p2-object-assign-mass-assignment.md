---
status: complete
priority: p2
issue_id: 027
tags: [code-review, security, data-integrity]
dependencies: []
---

# Object.assign Mass Assignment Risk in AdminsService.update()

## Problem Statement
`AdminsService.update()` uses `Object.assign(admin, updateDto)` to apply updates. If the DTO validation is misconfigured or bypassed, unexpected fields (like `role`, `isActive`, `passwordHash`) could be injected. While `ValidationPipe({ whitelist: true })` strips unknown properties, this defense is at the controller level only.

## Findings
- `src/modules/backoffice/admins.service.ts` uses `Object.assign(admin, updateDto)` in the update method
- `UpdateAdminDto` is a `PartialType(CreateAdminDto)` which includes fields like `role`
- The `whitelist: true` global pipe strips unknown fields at controller level, but if the service is called directly (e.g., from another service or job), there's no protection

## Proposed Solutions

### Option A: Explicit field picking
- **Description:** Replace `Object.assign(admin, updateDto)` with explicit field assignments: `admin.firstName = dto.firstName ?? admin.firstName` etc. Only update known safe fields.
- **Pros:** Clear about what can be updated; no surprise mutations; service-level safety
- **Cons:** More verbose; must update when new fields are added
- **Effort:** Small
- **Risk:** Low

### Option B: Use a pick/allowlist utility
- **Description:** Create a utility that picks only allowed fields from the DTO before assigning: `Object.assign(admin, pick(dto, ['firstName', 'lastName', 'email', 'role', 'isActive']))`.
- **Pros:** Concise; easy to maintain; explicit allowlist
- **Cons:** New utility to maintain
- **Effort:** Small
- **Risk:** Low

## Recommended Action
Option A implemented. Extracted explicit field picking into a private `applyUpdate()` method that only sets `firstName`, `lastName`, and `role`. Fields like `passwordHash`, `refreshTokenHash`, and `isActive` cannot be set via update.

## Technical Details
- **Affected files:** `src/modules/backoffice/admins.service.ts`
- **Components:** AdminsService

## Acceptance Criteria
- [x] Service-level protection against mass assignment regardless of DTO validation
- [x] `passwordHash` and `refreshTokenHash` cannot be set via update

## Work Log
- 2026-05-21: Created from PR #2 code review (Security sentinel)
- 2026-05-21: Resolved. Replaced both `Object.assign(admin, dto)` calls with `this.applyUpdate(admin, dto)`. Added private `applyUpdate()` method with explicit field assignments. Added mass assignment protection test.

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/2
