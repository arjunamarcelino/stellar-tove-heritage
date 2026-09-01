---
status: complete
priority: p2
issue_id: "067"
tags: [code-review, security, logging]
dependencies: []
---

# Tighten X-Request-Id UUID regex validation

## Problem Statement

The `genReqId` regex `/^[0-9a-f-]{36}$/i` in `app.module.ts` accepts any 36-character string of hex digits and hyphens. This means degenerate inputs like 36 dashes or strings without proper UUID structure pass validation and become correlation IDs in logs.

## Findings

- File: `src/app.module.ts`, line 54
- Current regex: `/^[0-9a-f-]{36}$/i`
- Accepts: `------------------------------------` (36 dashes), `abcdefabcdefabcdefabcdefabcdefabcdef` (no hyphens)
- Flagged by: ALL 6 review agents (TypeScript, security, performance, architecture, pattern, simplicity)
- Impact: malformed correlation IDs could reduce traceability in log aggregation

## Proposed Solutions

### Option 1: Use proper UUID regex (Recommended)

**Approach:** Replace with canonical UUID format validation.

```typescript
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```

**Pros:**
- Enforces standard UUID format (8-4-4-4-12)
- Hoisted to module scope for clarity
- Trivial change

**Cons:**
- Rejects non-standard but valid UUIDs (e.g., without hyphens) — acceptable trade-off

**Effort:** Small
**Risk:** Low

## Acceptance Criteria

- [ ] Regex enforces canonical UUID format (8-4-4-4-12)
- [ ] Regex is hoisted to module-level constant
- [ ] Valid UUIDs accepted, degenerate strings rejected
- [ ] Build passes

## Work Log

| Date | Action | Result |
|------|--------|--------|
| 2026-06-03 | Identified during PR #9 code review | All 6 agents flagged this |
| 2026-06-03 | Fixed: hoisted UUID_RE to module scope with canonical 8-4-4-4-12 pattern | Rejects degenerate inputs, proper UUID validation |

## Resources

- PR: https://github.com/Tove-Heritage/tove-be/pull/9
- File: `src/app.module.ts:54`
