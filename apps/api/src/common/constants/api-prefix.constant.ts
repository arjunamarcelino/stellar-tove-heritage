/**
 * Route prefixes for the two API surfaces — the single source of truth.
 *
 * `RouterModule` registration is evaluated at module-decoration time, before DI
 * exists, so these prefixes cannot come from `ConfigService`. `appConfig`
 * (`app.config.ts`) re-exports these same values, so the injected config
 * (cookie `path`, Swagger doc paths) always matches the routes RouterModule
 * registers. `.env` overrides work because `main.ts` imports `dotenv/config`
 * before this module is loaded.
 */
export const PUBLIC_API_PREFIX = process.env.API_PREFIX ?? 'api/v1';
export const BACKOFFICE_API_PREFIX = process.env.BACKOFFICE_API_PREFIX ?? 'api/backoffice/v1';
