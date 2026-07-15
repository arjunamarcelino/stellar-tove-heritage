import type { NextConfig } from 'next';

// CSRF note (see todo 091): Server Actions (e.g. money-adjacent setPrimaryWalletAction / wallet
// mutations) are protected by Next's built-in same-origin check on POST — it compares Origin against
// Host and rejects a mismatch. `serverActions.allowedOrigins` is intentionally left UNSET so only the
// exact same origin is trusted; add entries here ONLY if the app is served behind a proxy that
// rewrites the forwarded host. `X-Frame-Options: DENY` below additionally blocks framing-based CSRF.
const nextConfig = {
  output: 'standalone',
  typedRoutes: true,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            // Explicitly allow the WebAuthn ceremonies first-party only (passkey enrollment +
            // export signing); everything else stays denied (todo 066).
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), ' +
              'publickey-credentials-get=(self), publickey-credentials-create=(self)',
          },
        ],
      },
    ];
  },
} satisfies NextConfig;

export default nextConfig;
