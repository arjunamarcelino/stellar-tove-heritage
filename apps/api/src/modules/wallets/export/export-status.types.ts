/**
 * Single source of the export status vocabularies. The `as const` arrays are the canonical allowed
 * values — the TS unions derive from them, and the DB CHECK lists in migration 1716000000016 MUST mirror
 * these exact strings (kept in lockstep by referencing this file when authoring a status migration).
 */

/** Parent export roll-up state. `completed` = every item confirmed + the live-balance-zero gate passed. */
export const WALLET_EXPORT_STATUSES = ['pending', 'submitting', 'completed', 'failed'] as const;
export type WalletExportStatus = (typeof WALLET_EXPORT_STATUSES)[number];

/** Per-holding transfer state. `failed` is re-buildable on a resume; `confirmed` is terminal. */
export const WALLET_EXPORT_ITEM_STATUSES = ['pending', 'submitted', 'confirmed', 'failed'] as const;
export type WalletExportItemStatus = (typeof WALLET_EXPORT_ITEM_STATUSES)[number];

/** Which token an export item moves. */
export const EXPORT_TOKEN_KINDS = ['usdc', 'fraction'] as const;
export type ExportTokenKind = (typeof EXPORT_TOKEN_KINDS)[number];
