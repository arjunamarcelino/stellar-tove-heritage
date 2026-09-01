'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { offeringKeys } from '@/lib/query-keys';

import { approveOffering } from '../api';
import { classifyApproveOutcome } from '../offering-display';
import type { OfferingDetail } from '../schemas';
import type { ApproveOutcome } from '../offering-display';

export type { ApproveOutcome };

/**
 * Record the calling admin's approval. The idempotency key is an explicit mutate VARIABLE owned by the
 * container (minted per approve-INTENT on dialog-open, kept stable across `onError` retries of that same
 * intent, cleared on close/success). Reusing the same key on a lost-response retry lets the backend dedupe
 * → no double signature toward quorum; a genuinely new intent (re-approve after expiry) mints a fresh key.
 * On a quorum-reaching 202 (`deploying`) we optimistically flip the detail's escrow status so the CTA
 * locks and the self-poll arms — and DELIBERATELY do NOT invalidate the detail (a lagging read would
 * clobber the optimistic flag). The poll owns truth from there.
 */
export function useApproveOffering(id: string) {
  const queryClient = useQueryClient();

  return useMutation<ApproveOutcome, unknown, string>({
    mutationFn: async (idempotencyKey) => {
      try {
        const response = await approveOffering(id, idempotencyKey);
        return classifyApproveOutcome(response);
      } catch (error) {
        return classifyApproveOutcome(error); // maps neutral/not-a-signer; rethrows genuine errors
      }
    },
    onSuccess: (outcome) => {
      if (outcome.kind === 'accepted' && outcome.deploying) {
        // Optimistic deploying flip (nested spread preserves the i128 strings byte-identical). No detail
        // invalidation — the self-poll reconciles.
        queryClient.setQueryData<OfferingDetail>(offeringKeys.detail(id), (prev) =>
          prev ? { ...prev, escrow: { ...prev.escrow, deployStatus: 'deploying' } } : prev,
        );
      } else {
        // First-signer / neutralized / not-a-signer: no optimistic flag to protect → refetch fresh state.
        void queryClient.invalidateQueries({ queryKey: offeringKeys.detail(id) });
      }
      void queryClient.invalidateQueries({ queryKey: offeringKeys.lists() });
    },
  });
}
