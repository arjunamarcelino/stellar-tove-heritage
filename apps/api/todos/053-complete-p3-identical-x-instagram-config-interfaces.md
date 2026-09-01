---
status: complete
priority: p3
issue_id: "053"
tags: [code-review, quality, duplication]
dependencies: []
---

# XFollowConfig and InstagramFollowConfig Are Identical Interfaces

## Problem Statement

Two verification config interfaces (`XFollowConfig` and `InstagramFollowConfig`) have identical shapes. This is premature abstraction since auto-verification isn't implemented yet.

## Findings

- Both interfaces define `{ targetUsername: string }`
- No auto-verification implementation exists yet (YAGNI)
- Identified by: code-simplicity-reviewer (LOW)

## Proposed Solutions

### Option 1: Consolidate into single SocialFollowConfig

**Approach:** Replace both with `SocialFollowConfig { targetUsername: string }`.

**Effort:** Trivial | **Risk:** Low

### Option 2: Remove entirely until auto-verification is implemented

**Approach:** Delete the interfaces since they're unused YAGNI code.

**Effort:** Trivial | **Risk:** Low

## Acceptance Criteria

- [ ] No duplicate interfaces with identical shapes

## Work Log

### 2026-06-01 - Initial Discovery

**By:** Claude Code (PR #5 review)
