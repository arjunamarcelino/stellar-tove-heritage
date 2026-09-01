'use client';

import { useQuery } from '@tanstack/react-query';

import { allowlistKeys } from '@/lib/query-keys';
import { isValidContractAddress } from '@/lib/stellar';

import { getWalletStatus } from '../api';
import type { WalletStatusResult } from '../schemas';

/**
 * On-chain allowlist status for a committed wallet. Runs only for a valid C… address; transport
 * failures are already mapped to `{ status: 'unknown' }` in `getWalletStatus`, so `retry: false`.
 * Drive the pill skeleton off `isFetching`, not `isPending` (a disabled query reports pending/idle).
 */
export function useWalletStatus(wallet: string | null) {
  return useQuery<WalletStatusResult>({
    queryKey: allowlistKeys.status(wallet ?? ''),
    queryFn: () => getWalletStatus(wallet ?? ''),
    enabled: !!wallet && isValidContractAddress(wallet),
    staleTime: 15_000,
    retry: false,
  });
}
