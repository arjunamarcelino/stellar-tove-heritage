import { EntityManager } from 'typeorm';
import { KycAllowlistAction } from '../kyc-allowlist.types';
import { KycAllowlistState } from '../entities/kyc-allowlist-state.entity';

export const KYC_ALLOWLIST_STATE_REPOSITORY = 'IKycAllowlistStateRepository';

export interface KycAllowlistStateUpsert {
  wallet: string;
  isAllowed: boolean;
  lastAction: KycAllowlistAction;
  lastTxHash: string | null;
  // Intentional number-IN / string-OUT bigint asymmetry: the confirmed result carries `ledger` as a `number`,
  // but the DB column is `bigint` and TypeORM hydrates it as a `string` on read (see the entity + the status
  // DTO). Do not "normalize" one side to the other expecting a round-trip type (todo 273).
  lastLedger: number | null;
}

/**
 * Wallet-keyed mirror repo (natural PK, no surrogate id → does NOT extend BaseRepository). The mirror is
 * advisory and non-authoritative (the chain is the source of truth). Last-write-wins: writes come from
 * confirmed submissions serialized under the account lock, in ledger order (todo 232).
 */
export interface IKycAllowlistStateRepository {
  /**
   * Upsert the mirror row inside the CALLER'S transaction (last-write-wins). Takes an explicit `manager` so
   * the write is atomic with the event insert + audit row. Do NOT migrate this onto an injected repo (TOV-241).
   */
  upsert(input: KycAllowlistStateUpsert, manager: EntityManager): Promise<void>;
  /**
   * Advisory mirror read by wallet PK (TOV-241). NON-transactional (no `manager`) — reads have no atomicity
   * requirement. `null` = never seen; the caller maps that to `isAllowed:false` (200, not 404).
   */
  findByWallet(wallet: string): Promise<KycAllowlistState | null>;
}
