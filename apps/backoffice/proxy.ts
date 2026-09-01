import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = new Set(['/login']);

const PROTECTED_PREFIXES = ['/', '/missions', '/users'];

function isProtectedPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return false;
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const accessToken = request.cookies.get('access_token')?.value;

  // Authenticated user on login page → redirect to dashboard
  if (pathname === '/login' && accessToken) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Unauthenticated user on protected route → redirect to login
  if (isProtectedPath(pathname) && !accessToken) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
