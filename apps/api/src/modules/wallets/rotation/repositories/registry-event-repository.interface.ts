import { EntityManager } from 'typeorm';

export const REGISTRY_EVENT_REPOSITORY = 'IRegistryEventRepository';

/** A `custody_transfer` provenance row to append (one per confirmed rotation transfer). */
export interface RegistryEventInsert {
  userId: string;
  sourceWalletId: string;
  destinationWalletId: string;
  fromAddress: string;
  toAddress: string;
  tokenContract: string;
  amountScaled: string;
  txHash: string | null;
  ledger: number | null;
  /** Dedup key `rotation_item:{itemId}` — FULL-unique, so the insert is idempotent under replay/reconcile. */
  sourceRef: string;
}

export interface IRegistryEventRepository {
  /**
   * Append a `custody_transfer` row idempotently (`ON CONFLICT (source_ref) DO NOTHING`). MUST run inside
   * the caller's transaction (`manager`) so the provenance row commits atomically with the item-confirm.
   */
  recordCustodyTransfer(entry: RegistryEventInsert, manager: EntityManager): Promise<void>;
}
