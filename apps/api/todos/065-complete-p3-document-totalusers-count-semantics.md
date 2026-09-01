---
status: complete
priority: p3
issue_id: "065"
tags: [code-review, documentation, api]
dependencies: []
---

# Document totalUsers count semantics in dashboard API

## Problem Statement

In the mission stats response, `totalUsers` counts all distinct users with any submission, while `pending`, `accepted`, and `rejected` count distinct users per status. If a user has submissions in multiple statuses for the same mission, `totalUsers` will be less than `pending + accepted + rejected`. The `@ApiProperty` examples (45 = 12 + 30 + 3) imply they sum, which they may not.

## Findings

- **Source:** Data Integrity Guardian
- **File:** `src/modules/backoffice/dashboard/dto/dashboard-mission-stats-response.dto.ts`
- **Impact:** API consumers may incorrectly assume the three status counts sum to totalUsers

## Proposed Solutions

### Option A: Add @ApiProperty description clarifying semantics (Recommended)
Add description to `@ApiProperty` for `totalUsers` explaining it counts unique users, not submissions, so the status breakdowns may not sum to the total.
- **Pros:** Clear API contract, no code change
- **Cons:** None
- **Effort:** Small
- **Risk:** None

### Option B: Change to COUNT submissions instead of COUNT DISTINCT users
- **Pros:** Numbers would sum correctly
- **Cons:** Changes the metric semantics — totalUsers becomes totalSubmissions
- **Effort:** Medium
- **Risk:** Medium — changes API contract

## Recommended Action

Option A

## Technical Details

- **Affected files:** `src/modules/backoffice/dashboard/dto/dashboard-mission-stats-response.dto.ts`

## Acceptance Criteria

- [x] `@ApiProperty` for totalUsers includes description about unique user counting
- [x] All four count fields now have descriptions clarifying per-user semantics

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-06-03 | Created from PR #8 review | COUNT(DISTINCT user_id) across different FILTER conditions can produce totals that don't sum |
| 2026-06-03 | Fixed: added @ApiProperty descriptions to all four count fields | Clarifies that status counts are per-user and may overlap |

## Resources

- PR: https://github.com/Tove-Heritage/tove-be/pull/8
