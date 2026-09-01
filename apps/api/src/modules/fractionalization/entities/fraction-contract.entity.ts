import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';

/** Deploy lifecycle of a per-artwork FractionToken (TOV-233). `deployed`/`failed` are terminal. */
export type FractionContractStatus = 'deploying' | 'deployed' | 'failed';

/**
 * One row per fractionalization attempt for an artwork (TOV-233). The partial-unique index
 * `UQ_fraction_contracts_active_per_artwork` (migration) enforces at most one active
 * (`deploying|deployed`) token per artwork — `failed` is excluded so a new-key retry can insert a
 * fresh row. Numeric i128 amounts are stored as `numeric(39,0)` (bigint-safe strings in TypeORM).
 */
@Entity({ name: 'fraction_contracts' })
export class FractionContract extends BaseEntity {
  @Index('IDX_fraction_contracts_artwork', { where: '"deleted_at" IS NULL' })
  @Column({ name: 'artwork_id', type: 'uuid' })
  artworkId!: string;

  @Column({ type: 'varchar', length: 16, default: 'deploying' })
  status!: FractionContractStatus;

  @Column({ name: 'token_address', type: 'char', length: 56, nullable: true })
  tokenAddress!: string | null;

  @Column({ name: 'wasm_hash', type: 'char', length: 64 })
  wasmHash!: string;

  @Column({ name: 'token_name', type: 'varchar', length: 32 })
  tokenName!: string;

  @Column({ name: 'token_symbol', type: 'varchar', length: 12 })
  tokenSymbol!: string;

  /** Snapshot of the artist's primary settlement wallet at request time (TOCTOU freeze). */
  @Column({ name: 'artist_address', type: 'varchar', length: 56 })
  artistAddress!: string;

  /** Off-chain record for the later mint (i128, decimals=0). numeric → string in TypeORM. */
  @Column({ name: 'total_supply', type: 'numeric', precision: 39, scale: 0 })
  totalSupply!: string;

  @Column({ name: 'artist_retention_pct', type: 'int' })
  artistRetentionPct!: number;

  @Column({ name: 'treasury_retention_pct', type: 'int' })
  treasuryRetentionPct!: number;

  /** Resolved i128 amounts actually sent on-chain (null until deploy). */
  @Column({ name: 'artist_retention_amount', type: 'numeric', precision: 39, scale: 0, nullable: true })
  artistRetentionAmount!: string | null;

  @Column({ name: 'treasury_retention_amount', type: 'numeric', precision: 39, scale: 0, nullable: true })
  treasuryRetentionAmount!: string | null;

  @Column({ name: 'artist_lockup_days', type: 'int' })
  artistLockupDays!: number;

  @Column({ name: 'treasury_lockup_days', type: 'int' })
  treasuryLockupDays!: number;

  /**
   * Deploy-time-anchored artist lockup expiry (unix SECONDS) — the exact `computeLockupUntil(deployTs,
   * artist_lockup_days)` u64 baked on-chain (TOV-33, migration 052). Persisted by the deploy worker on
   * `casDeployed`; the wallet-rotation lockup gate reads it (`BigInt(now) < BigInt(until)`). Nullable:
   * null on legacy/self-heal rows → the rotation gate treats it as "not subject" (the on-chain token is the
   * hard backstop). Epoch seconds only, so `string | null` (BigInt compare) — never a raw u64 count.
   */
  @Column({ name: 'artist_lockup_until', type: 'bigint', nullable: true })
  artistLockupUntil!: string | null;

  /** Set before submit; lets a retry check `getTransaction(tx_hash)` first (also audit/provenance). */
  @Column({ name: 'tx_hash', type: 'char', length: 64, nullable: true })
  txHash!: string | null;

  /** Nullable: unrecoverable on the self-heal/reconcile path (chain deployed, DB latch lost). */
  @Column({ name: 'deploy_ledger', type: 'bigint', nullable: true })
  deployLedger!: string | null;
}
