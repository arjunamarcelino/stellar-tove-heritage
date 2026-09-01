---
status: complete
priority: p1
issue_id: "040"
tags: [code-review, data-integrity, database, migration]
dependencies: []
---

# No DB Constraint Preventing Multiple Accepted Submissions Per User+Mission

## Problem Statement

The application checks for existing accepted submissions in code before creating new ones, but there is no database-level unique constraint preventing multiple accepted submissions for the same user+mission pair. A race condition or direct DB manipulation could result in duplicate accepted submissions, corrupting progress tracking.

## Findings

- `src/modules/submissions/submissions.service.ts:submit()` — checks `findAccepted()` before saving, but this is a TOCTOU window
- Migration `1748796780526-CreateSubmissions.ts` has a partial unique index only for PENDING status: `CREATE UNIQUE INDEX ... WHERE status = 'pending' AND deleted_at IS NULL`
- No equivalent index exists for `status = 'accepted'`
- If two concurrent requests both pass the `findAccepted` check, both could be saved as pending, then both approved by admins
- Identified by: data-integrity-guardian (HIGH), security-sentinel (LOW/observation)

## Proposed Solutions

### Option 1: Add partial unique index for accepted status (Recommended)

**Approach:** Create a new migration adding `CREATE UNIQUE INDEX "IDX_submissions_user_mission_accepted" ON submissions (user_id, mission_id) WHERE status = 'accepted' AND deleted_at IS NULL`. Also add 23505 catch in the review service.

**Pros:**
- Database-level guarantee — impossible to have duplicates
- Follows existing pattern (pending index already exists)
- Minimal code change

**Cons:**
- New migration required

**Effort:** Small

**Risk:** Low

---

### Option 2: Single partial unique index covering both pending AND accepted

**Approach:** Replace the existing pending-only index with `WHERE status IN ('pending', 'accepted') AND deleted_at IS NULL`.

**Pros:**
- Single index handles both cases
- Slightly cleaner

**Cons:**
- Requires dropping and recreating the existing index
- PostgreSQL partial indexes don't support `IN` directly — would need `WHERE (status = 'pending' OR status = 'accepted') AND deleted_at IS NULL`

**Effort:** Small

**Risk:** Low

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `src/database/migrations/` — new migration file
- `src/modules/backoffice/submissions/submissions.service.ts:review()` — add 23505 catch when saving accepted status

**Database changes:**
- Migration needed: Yes
- New index: `IDX_submissions_user_mission_accepted` partial unique index

## Resources

- **PR:** #5
- **Existing pattern:** `IDX_submissions_user_mission_pending` in `1748796780526-CreateSubmissions.ts`

## Acceptance Criteria

- [ ] Partial unique index exists for accepted submissions (user_id + mission_id)
- [ ] Review service catches 23505 on accept and returns ConflictException
- [ ] Migration has correct `up()` and `down()` methods
- [ ] Both up and down paths tested

## Work Log

### 2026-06-01 - Initial Discovery

**By:** Claude Code (PR #5 review)

**Actions:**
- Data integrity guardian identified missing constraint
- Confirmed existing pending index as pattern reference
- Verified race condition window in submit + review flow

**Learnings:**
- Always add DB constraints for business uniqueness rules, not just application-level checks
- Partial unique indexes are the correct PostgreSQL pattern for status-scoped uniqueness
