---
status: complete
priority: p2
issue_id: "055"
tags: [code-review, architecture, nestjs]
dependencies: []
---

# Module Exports Use Provider Re-definition Instead of Token Re-export

## Problem Statement

Several modules export providers using `{ provide: 'IStageRepository', useClass: StageRepository }` in their `exports` array. This creates a new provider definition for consuming modules instead of re-exporting the singleton instance created internally. The correct NestJS pattern is to export the token string directly: `exports: ['IStageRepository']`.

## Findings

- `src/modules/backoffice/stages/stages.module.ts` — exports `{ provide: 'IStageRepository', useClass: StageRepository }`
- `src/modules/backoffice/missions/missions.module.ts` — exports `{ provide: 'IMissionRepository', useClass: MissionRepository }`
- `src/modules/submissions/submissions.module.ts` — exports `{ provide: 'ISubmissionRepository', useClass: SubmissionRepository }`
- Currently harmless because repositories are stateless, but would cause bugs if a repository becomes stateful (e.g., caching)
- Identified by: architecture-strategist (CONCERN 1)

## Proposed Solutions

### Option 1: Export token strings (Recommended)

**Approach:** Change `exports` to use string tokens:
```typescript
exports: ['IStageRepository'],
```

**Pros:**
- Re-exports the exact same singleton
- Correct NestJS pattern

**Cons:**
- None

**Effort:** Small

**Risk:** Low

## Technical Details

**Affected files:**
- `src/modules/backoffice/stages/stages.module.ts`
- `src/modules/backoffice/missions/missions.module.ts`
- `src/modules/submissions/submissions.module.ts`

## Acceptance Criteria

- [ ] All module exports use token strings, not provider definitions
- [ ] Application starts correctly
- [ ] All tests pass

## Work Log

### 2026-06-01 - Initial Discovery

**By:** Claude Code (PR #5 review)
