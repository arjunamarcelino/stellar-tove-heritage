'use client';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

import { walletStatusLabel, walletStatusVariant } from '../allowlist-display';
import type { WalletActionState, WalletLookupState } from '../schemas';

interface WalletStatusPillProps {
  state: WalletLookupState | WalletActionState | null;
  isFetching?: boolean;
}

/**
 * Status pill. The live region is always in the DOM (empty before a lookup) so a state transition
 * (e.g. Unknown → Whitelisted) is announced. Skeleton is driven by `isFetching`, not `isPending`.
 */
export function WalletStatusPill({ state, isFetching = false }: WalletStatusPillProps) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="min-h-5">
      {isFetching ? (
        <Skeleton className="h-5 w-28" />
      ) : state ? (
        <Badge variant={walletStatusVariant[state]}>{walletStatusLabel[state]}</Badge>
      ) : null}
    </div>
  );
}
