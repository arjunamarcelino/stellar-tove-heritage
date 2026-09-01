import { ConfigType } from '@nestjs/config';
import { Response } from 'express';
import { appConfig } from '@config/app.config';

/**
 * Single source of truth for the refresh-token cookie. Its name, path scoping,
 * and security attributes (`httpOnly`, `secure`, `sameSite`) are a security
 * contract shared by every issuer (`/auth/login`, `/auth/register`,
 * `/auth/refresh`, `/auth/sep10/verify`) and the logout clear — keep them here
 * so the set and clear sites can never drift.
 */
export const REFRESH_COOKIE_NAME = 'refresh_token';

const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function baseOptions(app: ConfigType<typeof appConfig>): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'strict';
  path: string;
} {
  return {
    httpOnly: true,
    secure: app.nodeEnv !== 'development',
    sameSite: 'strict',
    // Scoped so the refresh token is only sent to the refresh endpoint.
    path: `/${app.apiPrefix}/auth/refresh`,
  };
}

export function setRefreshCookie(
  res: Response,
  token: string,
  app: ConfigType<typeof appConfig>,
): void {
  res.cookie(REFRESH_COOKIE_NAME, token, { ...baseOptions(app), maxAge: REFRESH_MAX_AGE_MS });
}

export function clearRefreshCookie(res: Response, app: ConfigType<typeof appConfig>): void {
  res.clearCookie(REFRESH_COOKIE_NAME, baseOptions(app));
}
