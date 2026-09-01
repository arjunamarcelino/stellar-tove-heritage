---
status: complete
priority: p3
issue_id: "054"
tags: [code-review, quality, yagni]
dependencies: []
---

# Auto-Verification Infrastructure Is YAGNI

## Problem Statement

The codebase includes `VerificationMethod.AUTO_X_FOLLOW`, `AUTO_INSTAGRAM_FOLLOW` enum values, verification config interfaces, and `verificationConfig` column, but no auto-verification logic exists. This is infrastructure for a feature that doesn't exist yet.

## Findings

- `VerificationMethod` enum has AUTO values — never checked anywhere
- `verificationConfig` column defined on missions entity — never read by any verification logic
- Config interfaces defined but unused
- All submissions go through manual review regardless of `verificationMethod`
- Identified by: code-simplicity-reviewer (YAGNI observation)

## Proposed Solutions

### Option 1: Keep but acknowledge as planned (Recommended)

**Approach:** This was part of the original brainstorm. Keep the schema since it's already migrated, but don't add more infrastructure until auto-verification is actually being built.

**Effort:** None | **Risk:** None

### Option 2: Remove and re-add when needed

**Approach:** Remove AUTO enum values and config interfaces. Would require a migration to remove the column.

**Effort:** Medium (migration) | **Risk:** Low

## Acceptance Criteria

- [x] Decision documented: keep or remove

## Recommended Action

**Option 1: Keep but acknowledge as planned.** The schema is already migrated and auto-verification is a planned feature per the brainstorm. No further infrastructure will be added until the feature is actively built.

## Work Log

### 2026-06-01 - Initial Discovery

**By:** Claude Code (PR #5 review)

**Note:** The brainstorm document specified auto-verification as a planned feature. The schema supports it. The observation is about unused code, not wrong code.

### 2026-06-02 - Resolved

**By:** Claude Code
**Decision:** Keep. Schema is migrated, feature is planned. Duplicate config interfaces were consolidated into `SocialFollowConfig` in fix #053. Unused error codes (OAUTH_X_NOT_CONNECTED, OAUTH_TOKEN_EXPIRED) were removed in fix #051.
