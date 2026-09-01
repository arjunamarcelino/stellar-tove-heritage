import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';

import { artworkKeys } from '@/lib/query-keys';
import type { ArtworkListParams } from '@/types/api';

import { getArtworks, getArtwork, getFractionalizationStatus } from '../api';
import {
  TERMINAL_FRACTION_STATUSES,
  type ActiveFractionStatus,
  type ArtworkStatus,
  type FractionalizationStatusValue,
} from '../schemas';

// Absolute cap (~20 min at the 10s ceiling) so a stuck deploy eventually stops polling.
const MAX_POLL_ATTEMPTS = 120;

export function useArtworks(params: ArtworkListParams = {}) {
  return useQuery({
    queryKey: artworkKeys.list(params),
    queryFn: () => getArtworks(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useArtwork(id: string) {
  return useQuery({
    queryKey: artworkKeys.detail(id),
    queryFn: () => getArtwork(id),
    enabled: !!id,
    // Pick up a fractionalizing/failed transition (e.g. started in another tab) when the admin returns.
    refetchOnWindowFocus: true,
  });
}

/**
 * Poll the deploy-status endpoint while a fractionalization is in flight. Keyed on `artworkId` only, so
 * it self-resumes on remount from server truth. Auto-stops on a terminal status or the attempt cap.
 */
export function useFractionalizationStatus(id: string, enabled: boolean) {
  return useQuery({
    queryKey: artworkKeys.fractionalization(id),
    queryFn: () => getFractionalizationStatus(id),
    enabled: enabled && !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && TERMINAL_FRACTION_STATUSES.includes(status)) return false;
      if (query.state.dataUpdateCount >= MAX_POLL_ATTEMPTS) return false;
      // Linear backoff, capped at 10s, to avoid hammering a stuck deploy.
      return Math.min(2_000 + query.state.dataUpdateCount * 250, 10_000);
    },
    // Pause on hidden tabs so a stuck deploy doesn't poll forever in the background.
    refetchIntervalInBackground: false,
  });
}

/**
 * Owns the async deploy lifecycle for the artwork detail view: gates the poll on the artwork latch OR an
 * active `deploying` contract (so a deploy started elsewhere is picked up), fires the terminal toast +
 * invalidation once per transition, and derives the display flags. Keeps the component a pure read view.
 */
export function useFractionalizationLifecycle(
  id: string,
  artworkStatus: ArtworkStatus | undefined,
  fractionContractStatus: ActiveFractionStatus | undefined,
) {
  const queryClient = useQueryClient();
  const deployInFlight =
    artworkStatus === 'fractionalizing' || fractionContractStatus === 'deploying';
  const poll = useFractionalizationStatus(id, deployInFlight);
  const pollStatus = poll.data?.status;

  const prev = useRef<FractionalizationStatusValue | undefined>(undefined);
  useEffect(() => {
    if (!pollStatus || pollStatus === prev.current) return;
    if (pollStatus === 'deployed') {
      toast.success('Artwork fractionalized');
      void queryClient.invalidateQueries({ queryKey: artworkKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: artworkKeys.lists() });
    } else if (pollStatus === 'failed') {
      toast.error('Fractionalization failed. You can try again.');
      void queryClient.invalidateQueries({ queryKey: artworkKeys.detail(id) });
    }
    prev.current = pollStatus;
  }, [pollStatus, id, queryClient]);

  return {
    isDeploying: deployInFlight && pollStatus !== 'failed',
    deployFailed: deployInFlight && pollStatus === 'failed',
  };
}
