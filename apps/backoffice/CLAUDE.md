# Tove Backoffice

Admin dashboard for the Tove fractionalized art tokenization platform.

## Tech Stack

- **Framework:** Next.js 16 (App Router, Turbopack)
- **UI:** shadcn/ui + Tailwind CSS v4
- **Data Fetching:** TanStack Query v5
- **Forms:** React Hook Form + Zod
- **Package Manager:** pnpm
- **Language:** TypeScript (strict mode)

## Commands

- `pnpm dev` — Start development server
- `pnpm build` — Production build
- `pnpm lint` — ESLint check
- `pnpm start` — Start production server

## Conventions

- **Formatting:** Prettier with single quotes, trailing commas, semicolons, 100 char width
- **Imports:** Use `@/*` path alias (maps to `./src/*`)
- **Types:** All domain types inferred from Zod schemas via `z.infer<>` — no manual type duplication
- **Components:** PascalCase exports, kebab-case filenames
- **Hooks:** `use-` prefix, kebab-case filenames
- **API functions:** `get*`, `create*`, `update*`, `delete*` naming
- **Query keys:** Centralized in `lib/query-keys.ts`, use factories
- **No barrel exports:** Import directly from specific files
- **Commits:** Conventional Commits format

## Architecture

- **Feature-based structure:** Each domain (auth, missions, users, dashboard) in `src/features/`
- **API proxy pattern:** All client API calls go through `/api/*` Route Handlers
- **Server-only backend calls:** `lib/api-server.ts` for Server Component data fetching
- **Auth:** JWT in httpOnly cookies, never exposed to client JS
