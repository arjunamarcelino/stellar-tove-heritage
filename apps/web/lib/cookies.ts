import 'server-only';

import type { ResponseCookies } from 'next/dist/compiled/@edge-runtime/cookies';
import { COOKIE_KEYS } from '@/lib/constants';

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
