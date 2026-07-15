@AGENTS.md

## Project

Tove Heritage web app — an art investment platform for fractionalized RWA (Real World Assets). Next.js BFF consuming an Express REST API backend.

## Tech Stack

- Next.js 16 (App Router), TypeScript, Tailwind CSS v4
- Server Actions for form submissions (progressive enhancement)
- Zod v4 for input validation
- pnpm package manager

## Commands

- `pnpm dev` — Start dev server (Turbopack)
- `pnpm build` — Production build
- `pnpm lint` — Run ESLint
- `pnpm test` — Run Vitest (unit + component)
- `pnpm test:watch` — Vitest in watch mode
- `pnpm exec prettier --check .` — Check formatting
- `pnpm exec prettier --write .` — Fix formatting

## Architecture

```
Browser --> Next.js 16 (App Router) --> Express REST API
                |
                |- Server Components: static pages, data fetching
                |- Server Actions: form submissions (call lib/services/ directly)
                |- lib/services/: business logic (API calls to Express backend)
```

- **Server Actions call `lib/services/` directly** — no unnecessary API Route hop
- Services call the Express REST API via the shared `postJson`/`getJson`/`deleteJson` seam in `lib/services/http.ts` (env-guard → fetch → defensive JSON → `{ ok, status, data }`; a 204 resolves to `data: null`); pass a Bearer token for authenticated calls via `opts.headers` (never in the body). Use it + its `extractBackendMessage`/`extractBackendCode`/`extractFieldErrors`/`statusFallbackCode` helpers for new services rather than hand-rolling fetch
- Shared cookie helper in `lib/cookies.ts` (`setAuthTokenCookies`) — used by login, wallet, and passkey actions
- Browser-API wrappers live in `lib/webauthn/` (passkey) and `lib/wallet/` (Stellar) — `'use client'`, never throw, return a discriminated result; the client passes backend-issued options through verbatim

## Conventions

- Tailwind v4: theme tokens in `@theme` directive in `app/globals.css`, NOT `tailwind.config.ts`
- Path alias: `@/*` maps to project root
- Component structure: `components/layout/`, `components/sections/`, `components/auth/`, `components/ui/`
- Custom hooks in `hooks/` (e.g., `useMobileMenu`)
- Constants in `lib/constants.ts` with `as const` typing (`SITE_CONFIG`, `COOKIE_KEYS`, `NAV_LINKS`)
- Types in `lib/types/api.ts` — discriminated unions for all API/action result types
- Zod schemas and their derived types (`z.infer<>`) stay in the service file that owns them (e.g., `Stage` in `lib/services/auth.ts`)
- Validation helpers in `lib/validation.ts`
- Commit format: Conventional Commits (`feat(scope): description`)
- Brand fonts: Lora (headings), Montserrat (body) — config in `app/fonts.ts`
- Brand colors: umber, charcoal, ink, graphite, graphite-light, sienna, ochre, flint, rose-ash, parchment, bone, alabaster, cream

## Testing

- Vitest + Testing Library (jsdom); config in `vitest.config.ts`, setup in `vitest.setup.ts`
- Test files colocated as `*.test.ts(x)` next to source; shared fixtures in `test/fixtures/`
- Gotchas: `vi.mock('server-only', () => ({}))` in any test importing a `server-only` file; put mock fns/objects referenced by `vi.mock` factories in `vi.hoisted(() => ({...}))` (factories are hoisted above `const`s); for `instanceof` narrowing, the module mock must re-export the _same_ stub class the SUT imports
- Services: mock `fetch` via `vi.stubGlobal` and set `process.env.API_BASE_URL`. Actions: mock the service, `next/headers`, `next/navigation`, `@/lib/cookies`

## Verification

- `pnpm build` — must pass with zero errors before pushing
- `pnpm lint` — must pass with zero warnings
- `pnpm test` — must pass

## Environment Variables

- `API_BASE_URL` — Express backend URL (server-only, not exposed to client)
- `NEXT_PUBLIC_APP_URL` — This app's public URL (for OG images, canonical URLs)
- See `.env.example` for all variables
