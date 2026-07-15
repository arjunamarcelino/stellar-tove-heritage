import { registerAs } from '@nestjs/config';
import { PUBLIC_API_PREFIX, BACKOFFICE_API_PREFIX } from '@common/constants/api-prefix.constant';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  // Single source of truth: the same constants that RouterModule uses to prefix
  // routes (see api-prefix.constant.ts). Keeps cookie `path` and Swagger doc
  // paths in lockstep with the actual routes.
  apiPrefix: PUBLIC_API_PREFIX,
  backofficeApiPrefix: BACKOFFICE_API_PREFIX,
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3001',
  // Number of trusted reverse-proxy hops in front of the app. Drives Express
  // `trust proxy` so the throttler resolves the real client IP. Set to the real
  // hop count per environment (0 = no proxy / use socket IP; NOT `true`).
  trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10),
}));

export type AppConfig = ReturnType<typeof appConfig>;
