import { registerAs } from '@nestjs/config';

export const backofficeJwtConfig = registerAs('backofficeJwt', () => ({
  accessSecret: process.env.ADMIN_JWT_ACCESS_SECRET ?? process.env.JWT_ACCESS_SECRET!,
  refreshSecret: process.env.ADMIN_JWT_REFRESH_SECRET ?? process.env.JWT_REFRESH_SECRET!,
  refreshHmacSecret:
    process.env.ADMIN_REFRESH_TOKEN_HMAC_SECRET ?? process.env.REFRESH_TOKEN_HMAC_SECRET!,
  accessExpiration: process.env.ADMIN_JWT_ACCESS_EXPIRATION ?? '15m',
  refreshExpiration: process.env.ADMIN_JWT_REFRESH_EXPIRATION ?? '7d',
}));

export type BackofficeJwtConfig = ReturnType<typeof backofficeJwtConfig>;
