import 'server-only';

import { cookies } from 'next/headers';
import type { ResponseCookies } from 'next/dist/compiled/@edge-runtime/cookies';
import { COOKIE_KEYS } from '@/lib/constants';

// Read the caller's access token from the httpOnly cookie (server-side only — never accept it as a client
// argument). Shared by page Server Components and the money-flow server actions so the cookie key/shape lives
// in one place. `cookies()` is async in Next 16.
export async function readAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_KEYS.accessToken)?.value ?? null;
}

export function setAuthTokenCookies(
  cookieStore: ResponseCookies,
  accessToken: string,
  refreshToken: string,
) {
  const secure = process.env.NODE_ENV === 'production';

  // CSRF (todo 091): the access token is the ambient credential for Server Action mutations, incl.
  // money-adjacent ones (setPrimaryWalletAction). It is `sameSite: 'lax'` (not 'strict' like the
  // refresh token) so a top-level navigation into the app stays authenticated; CSRF on the mutations
  // themselves is covered by Next's same-origin Server Action check (see next.config.ts), not by this
  // flag. Revisit 'strict' here only if that framework guarantee is ever relaxed.
  cookieStore.set(COOKIE_KEYS.accessToken, accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60, // 1 hour
  });
  cookieStore.set(COOKIE_KEYS.refreshToken, refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });
}
