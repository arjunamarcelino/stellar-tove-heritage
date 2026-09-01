import { EntityManager } from 'typeorm';
import { IBaseRepository } from '@common/repositories/base-repository.interface';
import { FractionContract } from '../entities/fraction-contract.entity';

export const FRACTION_CONTRACT_REPOSITORY = 'IFractionContractRepository';

/** Result values latched onto a contract row when a deploy succeeds. */
export interface DeployedLatch {
  tokenAddress: string;
  deployLedger: string | null;
  artistRetentionAmount: string;
  treasuryRetentionAmount: string;
  /**
   * Deploy-time-anchored artist lockup expiry (unix seconds, the exact on-chain u64) — TOV-33 gate anchor.
   * Null on the self-heal/reconcile path (the true on-chain deploy time is unrecoverable) → the rotation
   * gate treats null as "not subject" and relies on the on-chain FractionToken as the hard backstop.
   */
  artistLockupUntil: string | null;
}

export interface IFractionContractRepository extends IBaseRepository<FractionContract> {
  /** The single active (`deploying|deployed`) contract for an artwork, if any (dedup/insert guard). */
  findActiveByArtworkId(artworkId: string): Promise<FractionContract | null>;

  /** Active (`deploying|deployed`, non-deleted) contracts for a set of artworks — batch list projection (TOV-240). */
  findActiveByArtworkIds(artworkIds: string[]): Promise<FractionContract[]>;

  /** All `deployed` (non-deleted) contracts — the holdings read fans balance() over these (TOV-237). */
  findAllDeployed(): Promise<FractionContract[]>;

  /** The most-recent contract row for an artwork INCLUDING `failed` (the status-read path). */
  findLatestByArtworkId(artworkId: string): Promise<FractionContract | null>;

  /** Record the submitted tx hash before polling (non-transactional; best-effort provenance). */
  setTxHash(id: string, txHash: string): Promise<void>;

  /** CAS `deploying → deployed`, latching the on-chain result. Returns true iff this writer won. */
  casDeployed(manager: EntityManager, id: string, latch: DeployedLatch): Promise<boolean>;

  /** CAS `deploying → failed`. Returns true iff this writer won. */
  casFailed(manager: EntityManager, id: string): Promise<boolean>;

  /** Rows stuck in `deploying` older than `graceMs`, oldest first, capped at `limit` (sweeper). */
  findStaleDeploying(graceMs: number, limit: number): Promise<FractionContract[]>;
}
