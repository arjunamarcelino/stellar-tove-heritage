import { ApiError } from '@/types/api';

import type { AllowlistItemResult, WalletActionState, WalletLookupState } from './schemas';

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive';
type PillState = WalletLookupState | WalletActionState;

// Typed as Record<> (like artwork-display.ts) → a missing label/variant is a compile error.
export const walletStatusLabel: Record<PillState, string> = {
  whitelisted: 'Whitelisted',
  'not-listed': 'Not whitelisted',
  unknown: 'Unknown',
  pending: 'Pending on-chain',
  // `deferred` = item was NOT attempted (an earlier batch item went pending and stopped the serial
  // loop). Recovery is an explicit resubmit. Practically unreachable for our batch-of-one.
  deferred: 'Not applied',
};

export const walletStatusVariant: Record<PillState, BadgeVariant> = {
  whitelisted: 'default',
  'not-listed': 'secondary',
  unknown: 'outline',
  pending: 'outline',
  deferred: 'outline',
};

// `errorReason` rides a 200 body → the proxy does NOT sanitize it. NEVER render it raw. Map by a
// stable code to friendly copy; an unrecognized value falls back to the generic message.
const failureCopy: Record<string, string> = {
  TX_SUBMIT_FAILED: 'On-chain submission failed — please try again',
};
export function friendlyFailure(code?: string | null): string {
  return (code && failureCopy[code]) || 'Action failed — please try again';
}

// Client-facing copy for a rejected mutation. Never surfaces a raw backend message.
export function actionErrorCopy(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'Superadmin role is required for this action';
    if (error.status === 429) return 'Too many requests — please wait a minute and try again';
    if (error.status === 401) return 'Your session expired — please sign in again';
  }
  return 'Something went wrong — please try again';
}

export type AllowlistUiOutcome = {
  // Only the TRANSIENT pill states (pending/deferred). For confirmed/noop the pill is written to the
  // query cache by the mutation hook (the source of truth), so the mapper returns null for them.
  pill: WalletActionState | null;
  toast: 'success' | 'info' | 'error';
  message: string;
  txHash: string | null;
};

function assertNever(value: never): never {
  throw new Error(`Unhandled allowlist result status: ${String(value)}`);
}

/**
 * Pure result → UI mapping (unit-tested in isolation; the component just renders this). For a
 * single-item synchronous POST the practical statuses are confirmed/noop/failed; pending/deferred
 * are batch artifacts kept for completeness.
 */
export function mapAllowlistResult(result: AllowlistItemResult): AllowlistUiOutcome {
  switch (result.status) {
    case 'confirmed':
      return {
        pill: null,
        toast: 'success',
        message: result.isAllowed
          ? 'Wallet added to the allowlist'
          : 'Wallet removed from the allowlist',
        txHash: result.txHash,
      };
    case 'noop':
      return {
        pill: null,
        toast: 'info',
        message: result.isAllowed
          ? 'No change — wallet is already whitelisted'
          : 'No change — wallet is not on the allowlist',
        txHash: null,
      };
    case 'pending':
      return { pill: 'pending', toast: 'info', message: 'Submitted — confirming on-chain', txHash: result.txHash };
    case 'deferred':
      return { pill: 'deferred', toast: 'info', message: 'Not applied — please retry the action', txHash: null };
    case 'failed':
      return { pill: null, toast: 'error', message: friendlyFailure(result.errorReason), txHash: null };
    default:
      return assertNever(result.status);
  }
}
