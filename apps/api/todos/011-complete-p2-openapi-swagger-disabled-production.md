---
status: complete
priority: p2
issue_id: 011
tags: [code-review, api-design, devops]
dependencies: []
---

# OpenAPI/Swagger Disabled in Production

## Problem Statement
In `src/main.ts` lines 51-60, Swagger/OpenAPI is only enabled when `NODE_ENV !== 'production'`. For an API-first platform (RWA tokenization), API consumers and partners need access to the OpenAPI spec in production to generate client SDKs, validate integrations, and build against the live API contract. Disabling it entirely in production forces consumers to rely on out-of-date documentation or manually maintained specs.

## Findings
- `src/main.ts` lines 51-60: Swagger setup is wrapped in a `NODE_ENV !== 'production'` conditional.
- The OpenAPI spec (JSON/YAML) and the Swagger UI are both disabled in production as a result.
- API consumers have no programmatic way to discover the API contract in production.

## Proposed Solutions

### Option A: Enable OpenAPI spec endpoint, disable Swagger UI in production
- **Description:** In production, serve the OpenAPI JSON spec at `/api/v1/docs/json` but do not mount the Swagger UI HTML page.
- **Pros:** API consumers can auto-generate clients from the production spec; minimal security exposure; small change.
- **Cons:** Spec endpoint could leak API structure to unauthorized parties (mitigated by placing behind auth if needed).
- **Effort:** Small
- **Risk:** Low

### Option B: Generate OpenAPI spec at build time as a static artifact
- **Description:** Add a build step that generates the OpenAPI spec at compile time and publishes it as a versioned artifact.
- **Pros:** Spec is versioned and immutable per release; no runtime endpoint needed.
- **Cons:** Requires build pipeline changes; may drift from runtime.
- **Effort:** Medium
- **Risk:** Low

## Recommended Action
Option A: Enable OpenAPI spec endpoint, disable Swagger UI in production

## Implemented Solution

Implemented **Option A** — serve the JSON spec in all environments, Swagger UI in dev only:

**Before:**
```typescript
// Swagger (development only)
if (appCfg.nodeEnv === 'development') {
  const config = new DocumentBuilder()...build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, documentFactory);
}
```

**After:**
```typescript
// OpenAPI spec (always available); Swagger UI (development only)
const config = new DocumentBuilder()...build();
const document = SwaggerModule.createDocument(app, config);

if (appCfg.nodeEnv === 'development') {
  SwaggerModule.setup('docs', app, () => document);
} else {
  // Serve JSON spec without Swagger UI in non-development environments
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get(`/${appCfg.apiPrefix}/docs/json`, (_req, res) => {
    res.json(document);
  });
}
```

- In **development**: Full Swagger UI at `/docs` (unchanged behavior).
- In **production/staging**: JSON spec at `/api/v1/docs/json` for SDK generation and contract testing.

### Commit
`dec9d68` — `fix(openapi): serve JSON spec in all environments, Swagger UI in dev only`

## Technical Details
- **Affected Files:** src/main.ts
- **Components:** Swagger/OpenAPI, NestJS Bootstrap, Production Configuration

## Acceptance Criteria
- [x] API consumers can access the OpenAPI spec in production environments
- [x] The spec accurately reflects the deployed API version
- [x] Swagger UI is not exposed in production (optional, depending on security requirements)
- [x] Non-production environments continue to have full Swagger UI access

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (JSON spec in all envs). Commit `dec9d68` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
