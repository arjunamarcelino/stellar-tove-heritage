import { NextResponse } from 'next/server';

import { backendTokenResponseSchema } from '@/features/auth/schemas';
import { requireCsrf } from '@/lib/api-proxy';
import { clearAuthCookies, getRefreshToken, setAuthCookies } from '@/lib/auth';
import { getEnv } from '@/lib/env';

export async function POST(request: Request) {
  const csrfError = requireCsrf(request);
  if (csrfError) return csrfError;
  const refreshToken = await getRefreshToken();

  if (!refreshToken) {
    return NextResponse.json(
      { error: { message: 'No refresh token', code: 'NO_REFRESH_TOKEN' } },
      { status: 401 },
    );
  }

  try {
    const response = await fetch(`${getEnv().BACKEND_API_URL}/v1/backoffice/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      await clearAuthCookies();
      return NextResponse.json(
        { error: { message: 'Refresh failed', code: 'REFRESH_FAILED' } },
        { status: 401 },
      );
    }

    const data = await response.json();
    const parsed = backendTokenResponseSchema.safeParse(data);
    if (!parsed.success) {
      await clearAuthCookies();
      return NextResponse.json(
        { error: { message: 'Invalid refresh response', code: 'PARSE_ERROR' } },
        { status: 502 },
      );
    }

    await setAuthCookies(parsed.data.accessToken, parsed.data.refreshToken);

    return NextResponse.json({ success: true });
  } catch {
    await clearAuthCookies();
    return NextResponse.json(
      { error: { message: 'Refresh failed', code: 'REFRESH_FAILED' } },
      { status: 401 },
    );
  }
}
