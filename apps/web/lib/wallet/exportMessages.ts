import type { WalletExportErrorCode } from '@/lib/types/api';

// Single source of truth for wallet-export error copy, shared by the server service (mapError
// fallbacks) and the client hook (reconcile-derived errors) so the two can't fork (todo 071). Kept
// client-safe (no 'server-only') so the hook can import it. Exhaustive over WalletExportErrorCode —
// adding a code fails to compile until copy is supplied.
export const EXPORT_MESSAGES: Record<WalletExportErrorCode, string> = {
  VALIDATION_FAILED: 'That address can’t be used as an export destination.',
  RECIPIENT_NOT_WHITELISTED: 'The destination must complete KYC before it can receive assets.',
  EXPORT_NOT_AVAILABLE: 'This wallet can’t be exported.',
  ALREADY_EXPORTED: 'This wallet has already been exported.',
  WALLET_NOT_FOUND: 'We couldn’t find that wallet.',
  EXPORT_NOT_FOUND: 'This export request could no longer be found. Please start again.',
  TRANSFER_SIGNATURE_INVALID: 'The signature couldn’t be verified. Please start again.',
  TRANSFER_EXPIRED: 'This request expired for your security. Please start again.',
  TRANSFER_SIMULATION_FAILED: 'The transfer couldn’t be prepared. Nothing was moved.',
  TRANSFER_FAILED: 'The transfer didn’t go through.',
  TRANSFER_UNAVAILABLE: 'Transfers are temporarily unavailable. Please try again shortly.',
  PASSKEY_FAILED: 'We couldn’t confirm your passkey. Please try again.',
  SESSION_EXPIRED: 'Your session expired. Please sign in again.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  SERVER_ERROR: 'Something went wrong on our end. Please try again.',
  NETWORK_ERROR: 'We couldn’t reach Tove. Check your connection and try again.',
};
