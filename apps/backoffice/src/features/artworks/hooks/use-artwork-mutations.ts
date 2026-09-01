'use client';

import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { artworkKeys } from '@/lib/query-keys';
import { ApiError } from '@/types/api';

import { fractionalizeArtwork } from '../api';
import type { ArtworkDetail, FractionalizeFormData, FractionalizationStatus } from '../schemas';

export type FractionalizeResult =
  | { kind: 'accepted'; status: FractionalizationStatus }
  | { kind: 'already' };

// Backend 409 codes that mean "no NEW deploy was triggered by this request" — safe to neutralize
// (suppress the global error toast) and reconcile from server truth via refetch. Other conflicts
// (e.g. ARTWORK_NOT_FRACTIONALIZABLE, or the 422 IDEMPOTENCY_KEY_MISMATCH) must surface as errors.
const NEUTRAL_CONFLICT_CODES = new Set([
  'ARTWORK_ALREADY_FRACTIONALIZED',
  'ARTWORK_FRACTIONALIZATION_IN_PROGRESS',
  'IDEMPOTENCY_KEY_IN_FLIGHT',
]);

/**
 * Deploy the per-artwork FractionToken. The idempotency key is minted once per submit attempt and passed
 * via mutation variables/closure, so a same-attempt retry (incl. the proxy's 401-refresh replay) reuses it.
 * The key is reset on BOTH success and error, so a user-initiated retry after a failure mints a fresh key —
 * the backend's artwork-state guard (409 IN_PROGRESS/ALREADY), not the key, is the real double-deploy guard.
 */
export function useFractionalizeArtwork(id: string) {
  const queryClient = useQueryClient();
  const keyRef = useRef<string | null>(null);

  return useMutation<FractionalizeResult, unknown, FractionalizeFormData>({
    mutationFn: async (data) => {
      if (!keyRef.current) keyRef.current = crypto.randomUUID();
      try {
        const status = await fractionalizeArtwork(id, data, keyRef.current);
        return { kind: 'accepted', status };
      } catch (error) {
        // Neutralize only conflicts that mean the deploy already exists / is underway.
        if (error instanceof ApiError && NEUTRAL_CONFLICT_CODES.has(error.code)) {
          return { kind: 'already' };
        }
        throw error;
      }
    },
    onSuccess: async () => {
      keyRef.current = null; // fresh key for any future attempt
      // Optimistically flip the cached detail to 'fractionalizing' so the CTA can't be re-clicked in the
      // window before the authoritative refetch lands. (The poll query owns the fractionalization key.)
      queryClient.setQueryData<ArtworkDetail>(artworkKeys.detail(id), (prev) =>
        prev ? { ...prev, status: 'fractionalizing' } : prev,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: artworkKeys.detail(id) }),
        queryClient.invalidateQueries({ queryKey: artworkKeys.lists() }),
      ]);
    },
    onError: () => {
      // A user-initiated retry must mint a NEW key. A fresh key cannot double-deploy: if the first attempt
      // actually landed server-side, the backend rejects the retry by artwork state (409 IN_PROGRESS/ALREADY).
      keyRef.current = null;
      void queryClient.invalidateQueries({ queryKey: artworkKeys.detail(id) });
    },
  });
}
