import { EntityManager } from 'typeorm';
import { WalletRotationTransfer } from '../entities/wallet-rotation-transfer.entity';
import { WalletRotationTransferItem } from '../entities/wallet-rotation-transfer-item.entity';

export const WALLET_ROTATION_REPOSITORY = 'IWalletRotationRepository';

/** Build/refresh a single rotation item's unsigned transfer + expiry (create if new). */
export interface RotationItemBuildInput {
  existingId?: string;
  rotationId: string;
  tokenContract: string;
  amountScaled: string;
  unsignedTxXdr: string;
  expiresAtLedger: number;
}

/**
 * Persistence for the wallet-rotation holdings transfer (TOV-33). Mirrors the export tracker repo, minus the
 * `exported` wallet latch (rotation never latches the source) and plus the atomic `registry_events`
 * custody-transfer write on the confirm/reconcile paths (via the caller-supplied `onConfirmed` manager
 * callback) + a `softCancel` to clear the one-active latch.
 */
export interface IWalletRotationRepository {
  /** The source wallet's in-flight (non-completed) rotation, with items loaded, or null. */
  findActiveBySourceWithItems(sourceWalletId: string): Promise<WalletRotationTransfer | null>;
  /** A rotation owned by (sourceWalletId, userId), with items — the owner-scoped submit/cancel lookup. */
  findOwnedWithItems(rotationId: string, sourceWalletId: string, userId: string): Promise<WalletRotationTransfer | null>;
  /** The source wallet's most-recent rotation (any status), with items — for the reconciliation status read. */
  findLatestBySourceWithItems(sourceWalletId: string): Promise<WalletRotationTransfer | null>;
  /** Create a fresh `pending` rotation (destination frozen here). Races are caught by the caller via 23505. */
  createRotation(
    sourceWalletId: string,
    userId: string,
    destinationWalletId: string,
    destinationAddress: string,
  ): Promise<WalletRotationTransfer>;
  /** Create or refresh a buildable (`pending`) item for one holding; returns the persisted row. */
  upsertItemBuild(input: RotationItemBuildInput): Promise<WalletRotationTransferItem>;
  /**
   * Atomically claim an item for submission: flip `pending`|`failed` -> `submitted` and return whether this
   * caller won. A concurrent submit that loses the CAS must NOT re-send — single-writer per item.
   */
  claimItemForSubmit(itemId: string): Promise<boolean>;
  /**
   * Mark an item confirmed on-chain (tx hash + ledger) AND write its `custody_transfer` registry row in the
   * SAME transaction via `onConfirmed(manager)` (idempotent `ON CONFLICT (source_ref) DO NOTHING`), so
   * provenance can never diverge from the confirm.
   */
  markItemConfirmed(
    itemId: string,
    txHash: string,
    ledger: number,
    onConfirmed: (manager: EntityManager) => Promise<void>,
  ): Promise<void>;
  /**
   * Reconcile a crash-stuck `submitted` item to `confirmed` when its balance is verifiably drained. Guarded
   * to `submitted` rows; writes the same atomic `custody_transfer` row (tx hash null when it was lost).
   * Returns whether a row was reconciled.
   */
  reconcileItemConfirmed(
    itemId: string,
    onConfirmed: (manager: EntityManager) => Promise<void>,
  ): Promise<boolean>;
  /** Mark an item failed with the mapped error code (re-buildable on resume). */
  markItemFailed(itemId: string, errorCode: string): Promise<void>;
  /**
   * Completion gate (in one transaction, source wallet row locked FOR UPDATE): if every item is confirmed
   * AND `allBalancesZero`, flip the rotation `completed` + run `onConfirm` (the confirm-time audit) in the
   * same tx; otherwise set it `submitting`. Returns whether the rotation completed. Unlike export there is
   * NO wallet latch — rotation only moves holdings.
   */
  finalizeIfAllConfirmed(
    rotationId: string,
    sourceWalletId: string,
    allBalancesZero: boolean,
    onConfirm: (manager: EntityManager) => Promise<void>,
  ): Promise<boolean>;
  /** Soft-delete a rotation + its items (clears the one-active latch). Caller enforces the no-in-flight gate. */
  softCancel(rotationId: string): Promise<void>;
}
