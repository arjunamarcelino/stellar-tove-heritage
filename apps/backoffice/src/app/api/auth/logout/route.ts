import { NextResponse } from 'next/server';

import { requireCsrf } from '@/lib/api-proxy';
import { clearAuthCookies, getAuthToken } from '@/lib/auth';
import { getEnv } from '@/lib/env';

export async function POST(request: Request) {
  const csrfError = requireCsrf(request);
  if (csrfError) return csrfError;

  const token = await getAuthToken();
  if (token) {
    try {
      await fetch(`${getEnv().BACKEND_API_URL}/v1/backoffice/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
    } catch {
      // Continue with local logout even if backend call fails
    }
  }

  await clearAuthCookies();

  return NextResponse.json({ success: true });
}
