---
status: complete
priority: p1
issue_id: "041"
tags: [code-review, data-integrity, architecture]
dependencies: []
---

# Soft-Deleting a Stage Does Not Cascade to Missions or Submissions

## Problem Statement

When an admin soft-deletes a stage, its child missions and their submissions remain active and visible. Users could still see and submit to missions belonging to a deleted stage. This creates orphaned data and inconsistent state.

## Findings

- `src/modules/backoffice/stages/stages.service.ts:softDelete()` — only soft-removes the stage entity
- No cascade to missions table — missions with `stageId` pointing to deleted stage remain active
- No cascade to submissions — pending submissions for those missions remain pending
- User-facing `getUserProgress()` filters by stage, so deleted stages won't show, but missions could still be accessible via direct API calls if a missions listing endpoint is added
- Identified by: data-integrity-guardian (HIGH)

## Proposed Solutions

### Option 1: Cascade soft-delete in service layer (Recommended)

**Approach:** In `StagesService.softDelete()`, after soft-removing the stage, also soft-remove all its missions. Pending submissions can optionally be auto-rejected or left for admin review.

**Pros:**
- Explicit, visible logic
- Can handle submissions policy (reject vs leave)
- No TypeORM cascade complexity

**Cons:**
- Multiple queries in one operation (should use transaction)

**Effort:** Small

**Risk:** Low

---

### Option 2: TypeORM cascade option on entity relation

**Approach:** Add `@OneToMany(() => Mission, m => m.stage, { cascade: ['soft-remove'] })` to Stage entity.

**Pros:**
- Automatic cascade

**Cons:**
- TypeORM soft-delete cascade behavior is unreliable/undocumented
- Less explicit — harder to understand and debug
- Doesn't handle submissions

**Effort:** Small

**Risk:** Medium — TypeORM cascade edge cases

---

### Option 3: Validate stage is empty before allowing delete

**Approach:** Throw an error if the stage has any active missions, forcing admin to delete missions first.

**Pros:**
- Simplest implementation
- No cascade complexity
- Forces deliberate cleanup

**Cons:**
- More friction for admins
- Doesn't prevent the data integrity issue if admin deletes missions first but misses some

**Effort:** Small

**Risk:** Low

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `src/modules/backoffice/stages/stages.service.ts:softDelete()` — add cascade logic or validation
- Potentially wrap in transaction using `runInTransaction`

**Related components:**
- MissionsService — may need bulk soft-delete method
- SubmissionsService — policy decision on pending submissions

## Resources

- **PR:** #5

## Acceptance Criteria

- [ ] Soft-deleting a stage handles its child missions appropriately
- [ ] Policy for pending submissions is defined and implemented
- [ ] Operation is wrapped in a transaction
- [ ] Unit tests cover the cascade behavior

## Work Log

### 2026-06-01 - Initial Discovery

**By:** Claude Code (PR #5 review)

**Actions:**
- Data integrity guardian identified orphaned missions risk
- Reviewed softDelete implementation — confirmed no cascade
- Identified three possible approaches

**Learnings:**
- Soft-delete cascades must be explicitly handled — TypeORM doesn't do this automatically
- Transaction wrapper needed for multi-entity operations
