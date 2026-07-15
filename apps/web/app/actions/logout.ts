'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_KEYS } from '@/lib/constants';

export async function logoutAction() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(COOKIE_KEYS.accessToken)?.value;

  const apiBaseUrl = process.env.API_BASE_URL;
  if (apiBaseUrl && accessToken) {
    try {
      await fetch(`${apiBaseUrl}/v1/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      // Best-effort revocation — still delete cookies on failure
    }
  }

  cookieStore.delete(COOKIE_KEYS.accessToken);
  cookieStore.delete(COOKIE_KEYS.refreshToken);

  redirect('/login');
}
