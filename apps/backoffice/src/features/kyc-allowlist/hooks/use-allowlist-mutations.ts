'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { allowlistKeys } from '@/lib/query-keys';
import { ApiError } from '@/types/api';

import { submitAllowlistAction } from '../api';
import { lookupStateFromIsAllowed } from '../schemas';
import type { AllowlistAction, AllowlistItemResult, WalletStatusResult } from '../schemas';

export type AllowlistMutationResult =
  | { kind: 'processed'; result: AllowlistItemResult }
  | { kind: 'conflict'; reason: 'all_noop' | 'in_flight' };

export interface AllowlistActionVars {
  action: AllowlistAction;
  reason?: string;
  // Minted once per user submit (crypto.randomUUID) and passed as a variable so it is stable across
  // any internal retry and trivially assertable in tests. A fresh key per submit is safe because
  // mutation auto-retry is off by default in v5.
  idempotencyKey: string;
}

// 409 codes CONFIRMED by backend (TOV-241 comment / tove-be PR #37): all items already in the target
// state → KYC_ALLOWLIST_ALL_NOOP; same Idempotency-Key still processing → IDEMPOTENCY_KEY_IN_FLIGHT.
// (Key reuse with a DIFFERENT batch is a separate 422 IDEMPOTENCY_KEY_MISMATCH — surfaces via onError.)
const CONFLICT_CODE: Record<string, 'all_noop' | 'in_flight'> = {
  KYC_ALLOWLIST_ALL_NOOP: 'all_noop',
  IDEMPOTENCY_KEY_IN_FLIGHT: 'in_flight',
};

/**
 * Add/remove `wallet` on the allowlist. The POST response is the pill's source of truth: on a result
 * carrying a non-null `isAllowed` (confirmed/noop) we `setQueryData` the status — and DELIBERATELY do
 * NOT invalidate, since a refetch of the (Unknown-prone) GET would clobber the authoritative value.
 */
export function useAllowlistAction(wallet: string) {
  const queryClient = useQueryClient();

  return useMutation<AllowlistMutationResult, unknown, AllowlistActionVars>({
    mutationFn: async ({ action, reason, idempotencyKey }) => {
      try {
        const result = await submitAllowlistAction({ wallet, action, reason }, idempotencyKey);
        return { kind: 'processed', result };
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          return { kind: 'conflict', reason: CONFLICT_CODE[error.code] ?? 'all_noop' };
        }
        throw error;
      }
    },
    onSuccess: (outcome) => {
      if (outcome.kind !== 'processed') return;
      const { isAllowed } = outcome.result;
      if (isAllowed !== null) {
        queryClient.setQueryData<WalletStatusResult>(allowlistKeys.status(wallet), {
          status: lookupStateFromIsAllowed(isAllowed),
          wallet,
        });
      }
    },
  });
}
