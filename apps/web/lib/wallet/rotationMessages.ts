import type { WalletRotationErrorCode, TransferItemCode } from '@/lib/types/api';

// Single source of truth for wallet-rotation copy, shared by the server service (mapError fallbacks)
// and the client hook (reconcile-derived errors) so the two can't fork. Client-safe (no 'server-only')
// so the hook can import it. Exhaustive over the unions — adding a code fails to compile until copy is
// supplied. Curated copy only; raw backend/Soroban diagnostics never reach the UI on this money path.
export const ROTATION_MESSAGES: Record<WalletRotationErrorCode, string> = {
  VALIDATION_FAILED: 'Something about this request wasn’t valid. Please start again.',
  WALLET_NOT_FOUND: 'We couldn’t find one of those wallets on your account.',
  ROTATION_SOURCE_INVALID: 'Only your embedded Tove wallet can be rotated.',
  ALREADY_EXPORTED: 'This wallet has already been drained and can’t be rotated.',
  ROTATION_DESTINATION_INVALID: 'Choose a connected wallet you own as the destination.',
  ROTATION_DESTINATION_NOT_PRIMARY:
    'Your new wallet needs to be your primary wallet before the move. We’ll set that up for you.',
  ROTATION_CONFLICT: 'A wallet move is already in progress on this wallet.',
  ROTATION_NOTHING_TO_TRANSFER: 'This wallet holds no fractions to move.',
  // Generic fallback; the review step composes a specific line naming the unlock date from lockupExpiresAt.
  ROTATION_BLOCKED_BY_LOCKUP: 'Some of your fractions are still locked and can’t be moved yet.',
  RECIPIENT_NOT_WHITELISTED:
    'Your new wallet isn’t approved to receive fractions yet. It must complete verification first.',
  ROTATION_NOT_FOUND: 'This wallet move could no longer be found. Please start again.',
  ROTATION_CANNOT_CANCEL:
    'This move can no longer be cancelled — some transfers are already underway.',
  PASSKEY_FAILED: 'We couldn’t confirm your passkey. Please try again.',
  SESSION_EXPIRED: 'Your session expired. Please sign in again.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  SERVER_ERROR: 'Something went wrong on our end. Please try again.',
  NETWORK_ERROR: 'We couldn’t reach Tove. Check your connection and try again.',
};

// Per-item settlement copy. Retryable items read as "retrying…"; terminal ones surface + stop.
export const TRANSFER_ITEM_MESSAGES: Record<TransferItemCode, string> = {
  TRANSFER_EXPIRED: 'This transfer expired and will be retried.',
  TRANSFER_UNAVAILABLE: 'Temporarily unavailable — retrying shortly.',
  TRANSFER_SIMULATION_FAILED: 'Preparing this transfer again…',
  TRANSFER_FAILED: 'This transfer didn’t go through — retrying.',
  TRANSFER_SIGNATURE_INVALID: 'This transfer couldn’t be verified. Please start the move again.',
  TRANSFER_SIGNATURE_REQUIRED:
    'This transfer needs a fresh signature. Please start the move again.',
  RECIPIENT_NOT_WHITELISTED:
    'Your new wallet can no longer receive this transfer — verification changed.',
};

// Retryable = safe to rebuild via the standard loop (poll status → initiate rebuilds non-zero-balance
// items → re-sign). Terminal = surface + stop (a retry recurs identically). Keyed on the union so a new
// TransferItemCode fails to compile until classified (TOV-33 Q2). Unknown codes are treated as terminal
// by classifyTransferItemCode below — never blind-rebuild something we can't classify.
export const TRANSFER_ITEM_RETRYABLE: Record<TransferItemCode, boolean> = {
  TRANSFER_EXPIRED: true,
  TRANSFER_UNAVAILABLE: true,
  TRANSFER_SIMULATION_FAILED: true,
  TRANSFER_FAILED: true,
  TRANSFER_SIGNATURE_INVALID: false,
  TRANSFER_SIGNATURE_REQUIRED: false,
  RECIPIENT_NOT_WHITELISTED: false,
};

// Curated copy for an unenumerated/unknown per-item code (terminal by default — never blind-rebuild
// something we can't classify). Named rather than an inline literal for consistency with the maps above.
export const TRANSFER_ITEM_FALLBACK_MESSAGE = 'This transfer couldn’t be completed.';

function isTransferItemCode(code: string): code is TransferItemCode {
  return Object.prototype.hasOwnProperty.call(TRANSFER_ITEM_RETRYABLE, code);
}

// Classify a per-item errorCode string (parsed as a bare string at the zod boundary so an unlisted
// backend code can't fail the whole parse). Unknown → terminal, with generic curated copy.
export function classifyTransferItemCode(code: string | undefined): {
  retryable: boolean;
  message: string;
} {
  if (code && isTransferItemCode(code)) {
    return { retryable: TRANSFER_ITEM_RETRYABLE[code], message: TRANSFER_ITEM_MESSAGES[code] };
  }
  return { retryable: false, message: TRANSFER_ITEM_FALLBACK_MESSAGE };
}

// Compose the lockup-block copy from the machine-readable ISO expiry (TOV-33 Q1). Falls back to the
// generic message when the date is missing/unparseable — the AC only needs the date named when present.
export function lockupBlockedMessage(lockupExpiresAt: string | undefined): string {
  if (!lockupExpiresAt) return ROTATION_MESSAGES.ROTATION_BLOCKED_BY_LOCKUP;
  const date = new Date(lockupExpiresAt);
  if (Number.isNaN(date.getTime())) return ROTATION_MESSAGES.ROTATION_BLOCKED_BY_LOCKUP;
  const formatted = date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `Some of your fractions are locked until ${formatted}. You can rotate once they unlock.`;
}
