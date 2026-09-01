import { useRef } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';

import { offeringKeys } from '@/lib/query-keys';
import type { OfferingListParams } from '@/types/api';

import { getOffering, getOfferings } from '../api';
import { isDeployInFlight, isLatched } from '../offering-display';

// Stop auto-polling after this wall-clock budget (still-deploying → passive "Check again"). Chosen over
// an attempt counter because the detail query is multi-purpose (mount + focus + optimistic write all bump
// dataUpdateCount), so a count-based cap would drift. See plan D1.
const POLL_BUDGET_MS = 90_000;

export function useOfferings(params: OfferingListParams = {}) {
  return useQuery({
    queryKey: offeringKeys.list(params),
    queryFn: () => getOfferings(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/**
 * Offering detail — ALSO the escrow-deploy poll target (no separate endpoint). Self-polls while a deploy
 * is in flight, with a monotonic arm: once `deploying` is observed it keeps polling until a genuine
 * terminal state (latched / failed / canceled), so a single lagging read that regresses `deployStatus`
 * to null can't prematurely stop the poll or un-lock the CTA. Auto-stops at the wall-clock budget and
 * DISARMS, so a manual "Check again" (invalidate → refetch) or a focus refetch re-arms a fresh budget.
 *
 * The arm is stored in component-instance refs; cross-offering isolation relies on the `key={id}` remount
 * at `app/(dashboard)/offerings/[id]/page.tsx` (navigating detail→detail must not reuse A's arm for B).
 */
export function useOffering(id: string) {
  const armed = useRef(false);
  const startedAt = useRef<number | null>(null);

  return useQuery({
    queryKey: offeringKeys.detail(id),
    queryFn: () => getOffering(id),
    enabled: !!id,
    // Small floor (under the 2s poll base) to suppress redundant focus/remount refetches while still
    // picking up an expiry reset / another admin's action.
    staleTime: 2_000,
    // Pick up an expiry reset / another admin's action when the tab regains focus.
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return false;

      if (isDeployInFlight(d) && !armed.current) {
        armed.current = true;
        startedAt.current = Date.now();
      }
      if (!armed.current) return false;

      // Terminal → disarm and stop.
      if (isLatched(d) || d.escrow.deployStatus === 'failed' || d.status === 'canceled') {
        armed.current = false;
        startedAt.current = null;
        return false;
      }

      // Wall-clock cap → stop polling AND disarm, so a manual "Check again" (invalidate → refetch) or a
      // focus refetch re-enters this callback with `!armed` and re-arms a fresh budget instead of being
      // stuck over the cap forever. Panel still shows "deploying" (derived from detail, not the refs).
      const elapsed = startedAt.current ? Date.now() - startedAt.current : 0;
      if (elapsed > POLL_BUDGET_MS) {
        armed.current = false;
        startedAt.current = null;
        return false;
      }

      // Gentle backoff 2s → 5s over the budget, so a slow deploy isn't hammered.
      return Math.min(2_000 + Math.floor(elapsed / 10_000) * 1_000, 5_000);
    },
    refetchIntervalInBackground: false,
  });
}
