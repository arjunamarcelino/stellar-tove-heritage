---
status: complete
priority: p1
issue_id: 001
tags: [code-review, security, api-design]
dependencies: []
---

# Cookie-Only Refresh Token Endpoint

## Problem Statement
The refresh token endpoint in `src/modules/auth/auth.controller.ts` (lines 72-83) ONLY reads refresh tokens from cookies. Non-browser clients (mobile apps, CLI tools, API consumers) cannot refresh their tokens at all. The refresh token is never returned in the response body during register/login - only set as an HttpOnly cookie. This makes the API unusable for any non-browser client.

## Findings
- `auth.controller.ts:72-83` - `@Post('refresh')` handler reads `req.cookies?.refresh_token`. There is no fallback to read the token from the request body or Authorization header.
- `auth.controller.ts:39-42` and `auth.controller.ts:59-62` - register/login set the refresh token as an HttpOnly cookie but do not include `refreshToken` in the response body.
- `auth.service.ts:36` returns `{ accessToken, refreshToken }` but the controller discards `refreshToken` from the response, only placing it in a cookie.

## Proposed Solutions

### Option A: Dual-channel refresh
- **Description:** Accept the refresh token from both the cookie AND the request body. Check the body first, fall back to the cookie. Return `refreshToken` in the response body alongside `accessToken` during register, login, and refresh.
- **Pros:** Single endpoint serves all client types; backward-compatible with existing cookie-based web flow; simple to implement.
- **Cons:** Slightly increases response payload size for web clients that don't need the body token.
- **Effort:** Small
- **Risk:** Low

### Option B: Separate endpoints
- **Description:** Keep the cookie-based `/refresh` endpoint for web clients. Add a new `/refresh/token` endpoint that accepts and returns refresh tokens in the request/response body for non-browser clients.
- **Pros:** Clear separation of concerns; each endpoint is purpose-built for its client type.
- **Cons:** Two endpoints to maintain; more surface area to secure; clients need to know which endpoint to use.
- **Effort:** Medium
- **Risk:** Low

## Recommended Action
Option A: Dual-channel refresh

## Implemented Solution

Implemented **Option A** — dual-channel refresh with the following changes:

### 1. `TokenResponseDto` updated (`src/modules/auth/dto/token-response.dto.ts`)
Added optional `refreshToken` field with `@ApiPropertyOptional` so it appears in the OpenAPI spec:
```typescript
export class TokenResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiPropertyOptional({ description: 'Refresh token (also set as HttpOnly cookie)' })
  refreshToken?: string;
}
```

### 2. New `RefreshDto` created (`src/modules/auth/dto/refresh.dto.ts`)
Accepts an optional refresh token in the request body:
```typescript
export class RefreshDto {
  @ApiPropertyOptional({ description: 'Refresh token (alternative to cookie)' })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
```

### 3. `AuthController` updated (`src/modules/auth/auth.controller.ts`)
- **register/login**: Now return `{ accessToken, refreshToken }` in the JSON body (previously only returned `{ accessToken }`).
- **refresh**: Accepts `@Body() dto: RefreshDto` and checks body first, falls back to cookie:
  ```typescript
  const refreshToken = dto.refreshToken ?? req.cookies?.[REFRESH_COOKIE_NAME];
  ```
  Returns `{ accessToken, refreshToken }` in the response body.

### 4. E2E tests updated (`test/e2e/auth.e2e-spec.ts`)
- Updated `TokenResponse` interface to include optional `refreshToken`.
- Existing cookie-based refresh test now also asserts `refreshToken` in body.
- Added new test: "should refresh tokens via request body" — registers, extracts `refreshToken` from response body, sends it in a `POST /auth/refresh` body, and asserts success.

### Commit
`768809c` — `fix(auth): support dual-channel refresh tokens for non-browser clients`

## Technical Details
- **Affected Files:** `src/modules/auth/auth.controller.ts`, `src/modules/auth/dto/token-response.dto.ts`, `src/modules/auth/dto/refresh.dto.ts` (new), `test/e2e/auth.e2e-spec.ts`
- **Components:** Auth module, token refresh flow, login/register response DTOs

## Acceptance Criteria
- [x] Non-browser clients can obtain refresh tokens from the response body during login/register
- [x] Non-browser clients can submit refresh tokens via request body to refresh their session
- [x] Existing cookie-based refresh flow continues to work for web clients
- [x] E2E tests cover both cookie-based and body-based refresh paths

## Work Log
| Date | Action | Details |
|------|--------|---------|
| 2026-05-18 | Created | Found during PR #1 code review |
| 2026-05-18 | Implemented | Option A (dual-channel). Commit `768809c` |

## Resources
- PR: https://github.com/Tove-Heritage/tove-be/pull/1
