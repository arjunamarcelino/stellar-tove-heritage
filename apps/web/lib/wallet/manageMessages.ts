import type {
  AddWalletErrorCode,
  RemoveWalletErrorCode,
  SetPrimaryWalletErrorCode,
} from '@/lib/types/api';

// Single source of truth for wallet add/remove error copy, shared by the server services (mapError
// fallbacks) and the client hook/dialogs so the two can't fork (mirrors exportMessages.ts). Kept
// client-safe (no 'server-only'). Exhaustive over each error-code union — adding a code fails to
// compile until copy is supplied. walletManage never surfaces a raw backend message (SEP-10 errors
// can echo XDR fragments / internal addresses), so these are the *only* strings the UI shows.

export const REMOVE_WALLET_MESSAGES: Record<RemoveWalletErrorCode, string> = {
  WALLET_NOT_FOUND: 'That wallet was already removed.',
  PRIMARY_WALLET_CANNOT_BE_REMOVED: 'You can’t remove your primary wallet.',
  WALLET_KIND_NOT_SUPPORTED:
    'This wallet can’t be removed here — export it to self-custody instead.',
  SESSION_EXPIRED: 'Your session expired. Please sign in again.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  NETWORK_ERROR: 'We couldn’t reach Tove. Check your connection and try again.',
  SERVER_ERROR: 'Something went wrong on our end. Please try again.',
};

// Set-primary curated copy. WALLET_KIND_NOT_SUPPORTED and WALLET_NOT_ELIGIBLE_FOR_PRIMARY share one
// string deliberately — both are UI-hidden race backstops the user should rarely see, so distinct
// copy would be wasted; don't "de-duplicate" them into one code.
export const SET_PRIMARY_WALLET_MESSAGES: Record<SetPrimaryWalletErrorCode, string> = {
  WALLET_NOT_FOUND: 'That wallet is no longer available.',
  WALLET_KIND_NOT_SUPPORTED: 'This wallet can’t be set as primary.',
  WALLET_NOT_ELIGIBLE_FOR_PRIMARY: 'This wallet can’t be set as primary.',
  SESSION_EXPIRED: 'Your session expired. Please sign in again.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  NETWORK_ERROR: 'We couldn’t reach Tove. Check your connection and try again.',
  SERVER_ERROR: 'Something went wrong on our end. Please try again.',
};

export const ADD_WALLET_MESSAGES: Record<AddWalletErrorCode, string> = {
  VALIDATION_FAILED: 'That wallet address couldn’t be used. Please try again.',
  AUTH_SIGNATURE_INVALID: 'The signature couldn’t be verified. Please try again.',
  AUTH_CHALLENGE_NOT_FOUND: 'That request expired. Please try again.',
  AUTH_CHALLENGE_EXPIRED: 'That request expired. Please try again.',
  AUTH_CHALLENGE_ALREADY_USED: 'That request was already used. Please try again.',
  WALLET_ALREADY_BOUND: 'This wallet is already linked to another Tove account.',
  IDEMPOTENCY_KEY_IN_FLIGHT: 'Still finishing your previous request — one moment…',
  IDEMPOTENCY_KEY_MISMATCH: 'Something changed mid-request. Please try again.',
  SESSION_EXPIRED: 'Your session expired. Please sign in again.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  NETWORK_ERROR: 'We couldn’t reach Tove. Check your connection and try again.',
  SERVER_ERROR: 'Something went wrong on our end. Please try again.',
};
