---
status: complete
priority: p2
issue_id: "068"
tags: [code-review, quality, logging]
dependencies: []
---

# Echo X-Request-Id in response when reusing valid client header

## Problem Statement

When a client sends a valid `X-Request-Id` header, the `genReqId` function returns it as the correlation ID but does not set it on the response. Only newly generated UUIDs get the response header. This breaks distributed tracing conventions where clients expect the correlation ID echoed back.

## Findings

- File: `src/app.module.ts`, lines 52-59
- When `existing` is valid: `return existing` (no `res.setHeader`)
- When generating new ID: `res.setHeader('X-Request-Id', id)` then `return id`
- Flagged by: kieran-typescript-reviewer, architecture-strategist

## Proposed Solutions

### Option 1: Always set response header (Recommended)

**Approach:** Set `res.setHeader('X-Request-Id', id)` regardless of source.

```typescript
genReqId: (req: IncomingMessage, res: ServerResponse) => {
  const existing = req.headers['x-request-id'];
  const id = typeof existing === 'string' && UUID_RE.test(existing)
    ? existing
    : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
},
```

**Pros:**
- Consistent behavior for all requests
- Standard distributed tracing convention
- Simplifies the code (single return path)

**Cons:**
- None

**Effort:** Small
**Risk:** Low

## Acceptance Criteria

- [ ] Response always includes `X-Request-Id` header
- [ ] Valid incoming IDs are echoed back
- [ ] Generated IDs are returned in response
- [ ] Build passes

## Work Log

| Date | Action | Result |
|------|--------|--------|
| 2026-06-03 | Identified during PR #9 code review | Flagged by TypeScript + architecture agents |
| 2026-06-03 | Fixed: unified to single return path, res.setHeader always called | Response always includes X-Request-Id regardless of source |

## Resources

- PR: https://github.com/Tove-Heritage/tove-be/pull/9
- File: `src/app.module.ts:52-59`
