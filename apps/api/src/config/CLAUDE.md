# Configuration

All application configuration uses the NestJS `registerAs` pattern with typed injection.

## Pattern

```typescript
// 1. Create config factory
export const myConfig = registerAs('my', () => ({
  setting: process.env.MY_SETTING ?? 'default',
}));
export type MyConfig = ReturnType<typeof myConfig>;

// 2. Add to app.module.ts
ConfigModule.forRoot({ load: [..., myConfig] })

// 3. Add to validation-schema.ts (Joi)
MY_SETTING: Joi.string().default('default'),

// 4. Inject with typed token
@Inject(myConfig.KEY)
private readonly my: ConfigType<typeof myConfig>,
```

Never use `configService.get('RAW_STRING')` -- always use typed injection.

## Files

- `app.config.ts` -- port, nodeEnv, corsOrigin, apiPrefix + backofficeApiPrefix (both re-exported from `@common/constants/api-prefix.constant.ts`), trustProxyHops (`TRUST_PROXY_HOPS`, default 1 -- Express `trust proxy` for correct client IP in rate limiting)
- `database.config.ts` -- PostgreSQL connection (uses `database.defaults.ts` for defaults)
- `database.defaults.ts` -- Shared DB defaults for config and CLI data-source
- `jwt.config.ts` -- Access/refresh token secrets and expiry
- `queue.config.ts` -- Redis connection for BullMQ
- `supabase.config.ts` -- Supabase connection (URL, service role key, bucket)
- `files.config.ts` -- File serving config (signed URL TTL)
- `throttle.config.ts` -- Rate limiting TTL and limit. `app.module.ts` backs the `ThrottlerModule` with **Redis storage** (`@nest-lab/throttler-storage-redis` on `redis.config`, `lazyConnect`) so per-route `@Throttle` limits are shared across instances / survive restarts (TOV-26 #171)
- `logger.config.ts` -- Pino log level and pretty-print toggle
- `backoffice-jwt.config.ts` -- Admin JWT secrets and expiry (optional, falls back to shared)
- `validation-schema.ts` -- Joi schema validating all env vars at startup

## Exception: route prefixes

`src/common/constants/api-prefix.constant.ts` (`PUBLIC_API_PREFIX`, `BACKOFFICE_API_PREFIX`) reads `process.env` directly -- the ONLY sanctioned bypass of the `registerAs` rule. `RouterModule` prefixes are resolved at module-decoration time, before DI exists, so they cannot be injected. `app.config.ts` re-exports these constants (single source of truth), and `main.ts` runs `import 'dotenv/config'` first so `.env` overrides reach the constants. The Joi schema still defines `API_PREFIX` / `BACKOFFICE_API_PREFIX` for startup validation.
