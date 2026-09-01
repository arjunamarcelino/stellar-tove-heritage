import 'server-only';

import { cookies } from 'next/headers';

import { backendTokenResponseSchema } from '@/features/auth/schemas';

import { getEnv } from './env';

const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

export async function getAuthToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(ACCESS_TOKEN_KEY)?.value;
}

export async function getRefreshToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(REFRESH_TOKEN_KEY)?.value;
}

export async function setAuthCookies(accessToken: string, refreshToken: string): Promise<void> {
  const cookieStore = await cookies();
  const isProduction = getEnv().NODE_ENV === 'production';

  cookieStore.set(ACCESS_TOKEN_KEY, accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: 60 * 15, // 15 minutes
    path: '/',
  });

  cookieStore.set(REFRESH_TOKEN_KEY, refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60, // 7 days
    path: '/api/auth/refresh',
  });
}

export async function clearAuthCookies(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACCESS_TOKEN_KEY);
  cookieStore.delete(REFRESH_TOKEN_KEY);
}

async function performRefresh(): Promise<boolean> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return false;

  try {
    const response = await fetch(`${getEnv().BACKEND_API_URL}/v1/backoffice/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) return false;

    const data = await response.json();
    const parsed = backendTokenResponseSchema.safeParse(data);
    if (!parsed.success) return false;

    await setAuthCookies(parsed.data.accessToken, parsed.data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

let refreshPromise: Promise<boolean> | null = null;

export async function refreshTokenIfNeeded(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = performRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}
