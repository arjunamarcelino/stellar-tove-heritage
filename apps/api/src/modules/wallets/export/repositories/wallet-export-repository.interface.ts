import { EntityManager } from 'typeorm';
import { WalletExport } from '../entities/wallet-export.entity';
import { WalletExportItem } from '../entities/wallet-export-item.entity';
import { ExportTokenKind } from '../export-status.types';

export const WALLET_EXPORT_REPOSITORY = 'IWalletExportRepository';

/** Build/refresh a single export item's unsigned transfer + challenge (create if new). */
export interface ItemBuildInput {
  existingId?: string;
  exportId: string;
  tokenContract: string;
  tokenKind: ExportTokenKind;
  amountScaled: string;
  unsignedTxXdr: string;
  expiresAtLedger: number;
}

export interface IWalletExportRepository {
  /** The wallet's in-flight (non-completed) export, with its items loaded, or null. */
  findActiveByWalletIdWithItems(walletId: string): Promise<WalletExport | null>;
  /** An export owned by (walletId, userId), with items loaded — the owner-scoped submit lookup. */
  findOwnedWithItems(exportId: string, walletId: string, userId: string): Promise<WalletExport | null>;
  /** The wallet's most-recent export (any status), with items — for the reconciliation status read. */
  findLatestByWalletIdWithItems(walletId: string): Promise<WalletExport | null>;
  /** Create a fresh `pending` export (target frozen here). Races are caught by the caller via 23505. */
  createExport(walletId: string, userId: string, targetAddress: string): Promise<WalletExport>;
  /** Create or refresh a buildable (`pending`) item for one holding; returns the persisted row. */
  upsertItemBuild(input: ItemBuildInput): Promise<WalletExportItem>;
  /**
   * Atomically claim an item for submission: flip `pending`|`failed` -> `submitted` in one UPDATE and
   * return whether this caller won the claim. A concurrent submit that loses the CAS (row already
   * `submitted`/`confirmed`) must NOT re-send the same item — single-writer per item (TOV-40 todo 125).
   */
  claimItemForSubmit(itemId: string): Promise<boolean>;
  /** Mark an item confirmed on-chain (tx hash + ledger). */
  markItemConfirmed(itemId: string, txHash: string, ledger: number): Promise<void>;
  /**
   * Reconcile a crash-stuck `submitted` item (sent on-chain, but the DB confirm was lost) to `confirmed`
   * when its balance is verifiably drained. Guarded to `submitted` rows; tx hash was lost so stays null.
   * Returns whether a row was reconciled. TOV-40 todo 127.
   */
  reconcileItemConfirmed(itemId: string): Promise<boolean>;
  /** Mark an item failed with the mapped error code (re-buildable on resume). */
  markItemFailed(itemId: string, errorCode: string): Promise<void>;
  /**
   * Authoritative completion gate (in one transaction, wallet row locked FOR UPDATE): if every item of
   * the export is confirmed, flip the export to `completed`, run `latchWallet` (the wallet aggregate's
   * own guarded `active -> exported` transition) + `onConfirm` (the confirm-time audit) in the SAME tx;
   * otherwise set the export `submitting`. Returns whether the wallet was latched exported.
   * `allBalancesZero` is the caller's live re-read gate — the wallet is never latched while any holding
   * remains. `latchWallet` keeps the `Wallet` write behind its own aggregate (not this export repo).
   */
  finalizeIfAllConfirmed(
    exportId: string,
    walletId: string,
    allBalancesZero: boolean,
    latchWallet: (manager: EntityManager) => Promise<boolean>,
    onConfirm: (manager: EntityManager) => Promise<void>,
  ): Promise<boolean>;
}
