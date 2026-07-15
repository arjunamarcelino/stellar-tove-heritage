export const SITE_CONFIG = {
  name: 'Tove Heritage',
  tagline: 'Fractional Art Ownership',
  description:
    'Tove Heritage enables fractional ownership of museum-quality fine art through blockchain tokenization. Invest in masterpieces starting from $100.',
  url: process.env.NEXT_PUBLIC_APP_URL ?? 'https://toveheritage.com',
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
} as const;

export const NAV_LINKS = [
  { label: 'Home', href: '/' },
  { label: 'Get Access', href: '/mission' },
  { label: 'App preview', href: '#' },
] as const;
