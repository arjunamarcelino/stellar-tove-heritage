export const SITE_CONFIG = {
  name: 'Tove Heritage',
  tagline: 'Fractional Art Ownership',
  description:
    'Tove Heritage enables fractional ownership of museum-quality fine art through blockchain tokenization. Invest in masterpieces starting from $100.',
  url: process.env.NEXT_PUBLIC_APP_URL ?? 'https://toveheritage.com',
  // Support inbox surfaced as a mailto: on the frozen/removed whitelist states (FR-01.08). Env-overridable
  // so a real routed address can replace the default without a code change.
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@toveheritage.com',
} as const;

export const COOKIE_KEYS = {
  accessToken: 'access_token',
  refreshToken: 'refresh_token',
} as const;

// Where a user lands once the required handle step is satisfied (FR-01.05): the commit action
// redirects here on success, and the onboarding page auto-skips here when a handle already exists.
// Single source of truth so the two can't drift.
export const ONBOARDING_NEXT_PATH = '/dashboard';

export const STELLAR_NETWORK = {
  name: (process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet') as 'testnet' | 'public',
  passphrase:
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
  // Public Horizon endpoint the app reads/submits against (TOV-47). Public, no auth header — never
  // API_BASE_URL. SDF public Horizon by default; env-overridable to a dedicated endpoint before
  // mainnet scale (the server-side badge derive egresses from a few IPs sharing one rate-limit bucket).
  horizonUrl:
    process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ??
    (process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'public'
      ? 'https://horizon.stellar.org'
      : 'https://horizon-testnet.stellar.org'),
} as const;

// Platform USDC asset, per network (TOV-47 / FR-01.11). This is the TRUST ANCHOR for the trustline
// flow: the sign path pins the bind-response asset to this, and the settings badge derive checks the
// account against it. Testnet issuer is Circle's published testnet issuer; the mainnet issuer is TBD
// (blocked pre-audit) → `issuer` is `undefined` there, which gates the feature to a neutral "check
// unavailable" state (no false "needed"/"ready", and the sign path refuses to sign an unpinned issuer).
// Flip NEXT_PUBLIC_STELLAR_USDC_ISSUER to light up mainnet with no code change.
export const PLATFORM_USDC = {
  code: process.env.NEXT_PUBLIC_STELLAR_USDC_CODE ?? 'USDC',
  issuer:
    process.env.NEXT_PUBLIC_STELLAR_USDC_ISSUER ??
    (process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'public'
      ? undefined
      : 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'),
} as const;

export const NAV_LINKS = [
  { label: 'Home', href: '/' },
  { label: 'Get Access', href: '/mission' },
  { label: 'App preview', href: '#' },
] as const;
