/**
 * Single source of the wallet-rotation status vocabularies (TOV-33). Mirrors the export vocabularies
 * (`export/export-status.types.ts`) — the `as const` arrays are the canonical allowed values, the TS
 * unions derive from them, and the DB CHECK lists in migration 1716000000053 MUST mirror these exact
 * strings. Rotation moves fraction holdings only, so there is no token-kind axis (unlike export's USDC vs
 * fraction).
 */

/** Parent rotation-transfer roll-up state. `completed` = every item confirmed + the live-balance-zero gate passed. */
export const WALLET_ROTATION_STATUSES = ['pending', 'submitting', 'completed', 'failed'] as const;
export type WalletRotationStatus = (typeof WALLET_ROTATION_STATUSES)[number];

/** Per-token transfer state. `failed` is re-buildable on a resume; `confirmed` is terminal. */
export const WALLET_ROTATION_ITEM_STATUSES = ['pending', 'submitted', 'confirmed', 'failed'] as const;
export type WalletRotationItemStatus = (typeof WALLET_ROTATION_ITEM_STATUSES)[number];
