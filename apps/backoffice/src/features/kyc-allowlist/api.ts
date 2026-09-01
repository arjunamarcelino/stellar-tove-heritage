import { api } from '@/lib/api-client';
import { isValidContractAddress } from '@/lib/stellar';
import { ApiError } from '@/types/api';

import {
  allowlistBatchResponseSchema,
  lookupStateFromIsAllowed,
  walletStatusSchema,
  type AllowlistActionInput,
  type AllowlistItemResult,
  type WalletStatusResult,
} from './schemas';

/**
 * Read a wallet's current on-chain allowlist status. Error handling is inverted to an allow-list of
 * ACTIONABLE errors: only `401`/`403` surface (session / permissions). Everything else — `404`
 * (endpoint not deployed yet), `5xx`, `429`, or a raw network `TypeError` — degrades to `unknown`
 * so the pill stays usable. Fires only for a valid C… wallet (the query's `enabled` guard).
 */
export async function getWalletStatus(wallet: string): Promise<WalletStatusResult> {
  // Defense-in-depth: never interpolate an unvalidated wallet into the proxy path. The query already
  // gates on validity and the BFF re-validates, but this guards a future non-UI caller from path injection.
  if (!isValidContractAddress(wallet)) return { status: 'unknown', wallet };
  try {
    const { isAllowed } = walletStatusSchema.parse(
      await api.get(`/api/kyc/allowlist/${encodeURIComponent(wallet)}`),
    );
    return { status: lookupStateFromIsAllowed(isAllowed), wallet };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error;
    return { status: 'unknown', wallet };
  }
}

/**
 * Add or remove a single wallet via the batch endpoint (batch-of-one). Omits `reason` entirely when
 * blank (never sends ''). Guards `results[0]` because `noUncheckedIndexedAccess` types it as optional.
 */
export async function submitAllowlistAction(
  input: AllowlistActionInput,
  idempotencyKey: string,
): Promise<AllowlistItemResult> {
  const item = {
    wallet: input.wallet,
    action: input.action,
    ...(input.reason ? { reason: input.reason } : {}),
  };
  const res = await api.post('/api/kyc/allowlist', { items: [item] }, { idempotencyKey });
  const [result] = allowlistBatchResponseSchema.parse(res).results;
  if (!result) {
    throw new ApiError('Allowlist response contained no results', 0, 'EMPTY_ALLOWLIST_RESULT');
  }
  return result;
}
