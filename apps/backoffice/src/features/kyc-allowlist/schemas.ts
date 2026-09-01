import { z } from 'zod';

import { isValidContractAddress } from '@/lib/stellar';

// Mirrors the backend KYC_ALLOWLIST_ACTIONS / KYC_ALLOWLIST_RESULTS tuples (TOV-235).
export const allowlistActionSchema = z.enum(['add', 'remove']);
export type AllowlistAction = z.infer<typeof allowlistActionSchema>;

export const allowlistResultStatusSchema = z.enum([
  'confirmed',
  'pending',
  'failed',
  'noop',
  'deferred',
]);

// Machine-readable snake_case reason code. Omitted (never '') when empty — enforced in api.ts.
// Single source of truth for the rule, reused by the dialog's optional-empty form validation.
export const REASON_PATTERN = /^[a-z0-9_]{1,64}$/;
export const reasonSchema = z
  .string()
  .regex(REASON_PATTERN, 'Reason must be lowercase letters, digits or underscore (max 64)');

// wallet = Collector smart-wallet CONTRACT StrKey (C…), validated with the shared helper.
export const walletSchema = z
  .string()
  .refine(
    isValidContractAddress,
    'Enter a valid Collector smart-wallet contract address (C…, 56 chars)',
  );

// One requested mutation. `.strict()` so unknown fields can't reach the on-chain write.
export const allowlistActionInputSchema = z
  .object({
    wallet: walletSchema,
    action: allowlistActionSchema,
    reason: reasonSchema.optional(),
  })
  .strict();
export type AllowlistActionInput = z.infer<typeof allowlistActionInputSchema>;

// Wire request — batch-of-one for the single-wallet UI.
export const allowlistBatchRequestSchema = z
  .object({ items: z.array(allowlistActionInputSchema).length(1) })
  .strict();

// Response — deliberately LENIENT (no .strict()) so additive backend fields don't break parsing.
// Client Zod runs AFTER bytes cross the proxy, so it does NOT prevent field leakage; that is a
// server-side concern (the backend DTO returns exactly these keys — PR #33).
export const allowlistItemResultSchema = z.object({
  wallet: z.string(),
  action: allowlistActionSchema,
  status: allowlistResultStatusSchema,
  isAllowed: z.boolean().nullable(),
  txHash: z.string().nullable(),
  errorReason: z.string().nullable(),
});
export type AllowlistItemResult = z.infer<typeof allowlistItemResultSchema>;

// No `.min(1)` here — the empty case is enforced by the typed guard in api.ts (EMPTY_ALLOWLIST_RESULT),
// which is also what `noUncheckedIndexedAccess` requires for `results[0]`. Keeps one enforcement point.
export const allowlistBatchResponseSchema = z.object({
  results: z.array(allowlistItemResultSchema),
});

// GET wallet-status. Only `isAllowed` is consumed (the caller already knows the wallet), so `wallet`
// is not required here — the backend's additive provenance fields (lastAction/lastTxHash/…) and the
// echoed `wallet` are simply dropped by this non-strict object. Removing the unused required field
// also eliminates a failure mode where a body without `wallet` would throw → silent "unknown" pill.
export const walletStatusSchema = z.object({ isAllowed: z.boolean() });

// Client-side VIEW MODEL (hand-authored, not on the wire). A discriminated union so `unknown`
// (endpoint unavailable) can NEVER be conflated with `not-listed`. Tags double as display-map keys.
export type WalletLookupState = 'whitelisted' | 'not-listed' | 'unknown';
export type WalletStatusResult = { status: WalletLookupState; wallet: string };

/**
 * Single source of truth for the on-chain `is_allowed` → lookup-state mapping. Used by both the GET
 * path (`getWalletStatus`) and the POST cache-write (`useAllowlistAction`) so the pill can't drift.
 */
export function lookupStateFromIsAllowed(isAllowed: boolean): WalletLookupState {
  return isAllowed ? 'whitelisted' : 'not-listed';
}

// Transient states that come from the POST path only (never the GET query).
export type WalletActionState = 'pending' | 'deferred';
