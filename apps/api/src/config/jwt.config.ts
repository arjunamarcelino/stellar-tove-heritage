import { registerAs } from '@nestjs/config';

export const jwtConfig = registerAs('jwt', () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET!,
  refreshSecret: process.env.JWT_REFRESH_SECRET!,
  refreshHmacSecret: process.env.REFRESH_TOKEN_HMAC_SECRET!,
  accessExpiration: process.env.JWT_ACCESS_EXPIRATION ?? '15m',
  refreshExpiration: process.env.JWT_REFRESH_EXPIRATION ?? '7d',
}));

export type JwtConfig = ReturnType<typeof jwtConfig>;
