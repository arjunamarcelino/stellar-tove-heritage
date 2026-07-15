import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Enforcing, nonce-based Content-Security-Policy (todo 066). This is the primary backstop that blunts
// an XSS on an irreversible asset-transfer flow — it stops injected inline scripts from rewriting the
// confirm-screen destination/holdings or driving the passkey ceremony. Next injects the per-request
// nonce onto its framework/page scripts automatically once it sees `'nonce-…'` in the CSP header.
//
// NOTE: nonce-based CSP requires dynamic rendering (see app/layout.tsx `dynamic = 'force-dynamic'`);
// static optimization / CDN caching of pages is disabled as a result.
// The handle-availability check (FR-01.05 / B1) is the ONE direct browser→backend call: a public,
// tokenless GET made client-side so the backend's per-IP throttle keys on the real client IP. It needs
// the Express origin in connect-src. Derived from the public base URL; empty (→ same-origin only) if
// unset or malformed. Everything else still talks to this BFF server-side.
//
// Trade-offs (todo 103): (1) connect-src authorizes the *entire* backend origin, not just
// /v1/handles/check — under an XSS the browser could fetch any endpoint on that origin, a modest
// widening vs the prior 'self'-only policy. Accepted: it's the same API host the BFF already uses.
// (2) `URL.origin` neutralizes breakout chars (no spaces/semicolons/newlines), so this can't inject
// into the CSP. (3) If NEXT_PUBLIC_API_BASE_URL is unset/malformed this returns '' → same-origin-only
// CSP → the availability check is blocked by CSP; lib/handle/checkHandle.ts independently returns
// SERVER_ERROR for the same missing var, so a misconfig fails safe (checks error out, nothing leaks).
function backendConnectOrigin(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return '';
  try {
    return new URL(base).origin;
  } catch {
    return '';
  }
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';

  // Same-origin by default: the browser talks to this BFF (Server Actions POST to self), the Express
  // backend is reached server-side. The single exception is the direct public handle-availability
  // check, whose origin is added to connect-src below. Stellar Expert is opened via target=_blank
  // navigation (not fetch), so it needs no connect-src entry.
  const backendOrigin = backendConnectOrigin();
  const connectSrc = backendOrigin ? `'self' ${backendOrigin}` : `'self'`;
  const csp = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''};
    style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`};
    img-src 'self' blob: data:;
    font-src 'self';
    media-src 'self';
    connect-src ${connectSrc};
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `
    .replace(/\s{2,}/g, ' ')
    .trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    // All paths except API routes, Next static assets, image optimizer, and the favicon; skip
    // link-prefetches so cached prefetch responses don't carry a stale nonce.
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
