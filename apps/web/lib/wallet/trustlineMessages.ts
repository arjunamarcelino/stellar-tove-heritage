import type { TrustlineErrorCode, TrustlineStatus } from '@/lib/types/api';

// Curated, user-facing copy for the BYOW USDC trustline flow (TOV-47). Client-safe (no `server-only`)
// — these are the only strings the dialog/badge show. We never surface raw Horizon result_codes or
// backend messages (they can echo XDR / internal detail), mirroring lib/wallet/manageMessages.ts.

// Exhaustive over TrustlineErrorCode (a new code is a compile error here).
export const TRUSTLINE_MESSAGES: Record<TrustlineErrorCode, string> = {
  ISSUER_MISMATCH:
    'This wallet was asked to trust an unexpected USDC issuer. For your safety we stopped — please contact support.',
  ISSUER_UNCONFIGURED:
    'USDC isn’t available on this network yet, so the trustline can’t be added here.',
  ACCOUNT_MISMATCH:
    'Your wallet is on a different account. Switch to the connected wallet to continue.',
  NETWORK_MISMATCH:
    'Your wallet is on a different network. Switch it to the correct network to continue.',
  WALLET_NOT_INSTALLED: 'We couldn’t find your wallet. Install or unlock it, then try again.',
  POPUP_BLOCKED: 'Your browser blocked the wallet popup. Allow popups for this site and try again.',
  USER_CANCELLED: 'Signing was cancelled. You can try again when you’re ready.',
  UNFUNDED:
    'This wallet has never been funded. Fund it with a little XLM first, then add the USDC trustline.',
  REBUILD_EXHAUSTED:
    'Another app may be using this wallet. Please try adding the trustline again in a moment.',
  CONFIRMATION_PENDING:
    'We couldn’t confirm the trustline just yet — it may still be processing. The status will update shortly.',
  SUBMIT_FAILED: 'We couldn’t add the USDC trustline. Please try again.',
  HORIZON_UNAVAILABLE: 'We couldn’t reach the Stellar network. Please try again in a moment.',
};

// Settings-row badge copy, exhaustive over TrustlineStatus. `active` shows no badge (the wallet is
// ready), so it carries an empty label; the row simply omits the badge for it. 'unavailable'/'unknown'
// deliberately SHARE neutral copy — they are distinct states (no issuer configured vs. Horizon read
// failed) but read the same to the user; do not "de-dupe" them into one status.
export const TRUSTLINE_STATUS_COPY: Record<TrustlineStatus, { badge: string }> = {
  active: { badge: '' },
  missing: { badge: 'USDC trustline needed' },
  unfunded: { badge: 'USDC trustline needed' },
  unavailable: { badge: 'USDC check unavailable' },
  unknown: { badge: 'USDC check unavailable' },
};
