/**
 * Port for the on-chain OfferingEscrow lifecycle (TOV-154 deploy, FR-05.02; TOV-160 close+settle, FR-05.05).
 * TWO consumers depend on these EXACT names: the deploy worker AND the settle worker (each binds the
 * `SorobanOfferingEscrowService` in its own worker module — the neutral `OfferingsModule` stays config-free).
 * Distinct from `FRACTION_FACTORY_SERVICE` (the token-mint port) so escrow-specific types never leak into
 * fractionalization consumers.
 */
export const OFFERING_ESCROW_SERVICE = 'IOfferingEscrowService';

/**
 * The 8 positional OfferingEscrow constructor arguments, in ABI order. Amounts are `bigint` at this
 * boundary (Enhancement #13) so a wrong-typed/wrong-ordered arg is a compile error, not a runtime
 * host-reject; `encodeConstructorArgs` is the ONE place the positional order lives.
 */
export interface OfferingConstructorArgs {
  usdc: string;
  totalSupply: bigint;
  artist: string;
  artistRetention: bigint;
  treasury: string;
  treasuryRetention: bigint;
  artistPayout: string;
  admin: string;
}

export interface DeployEscrowInput {
  offeringId: string;
  args: OfferingConstructorArgs;
}

export interface DeployEscrowResult {
  contractAddress: string;
  /** Empty (`''`) on the self-heal path (the contract already existed; no submit happened this call). */
  txHash: string | null;
}

/** On-chain OfferingEscrow lifecycle status (`storage.rs::Status`) — the self-heal oracle for settlement. */
export type OfferingEscrowStatus = 'open' | 'closed' | 'settled' | 'cancelled' | 'unknown';

/** A winner passed to `close_and_settle`: on-chain bid id + fractions allocated (TOV-160). */
export interface SettleAllocation {
  bidId: number;
  allocated: bigint;
}

export interface CloseOfferingInput {
  offeringId: string;
  escrowAddress: string;
}

export interface CloseAndSettleInput {
  offeringId: string;
  escrowAddress: string;
  clearingPrice: bigint;
  allocations: SettleAllocation[];
}

export interface CloseAndSettleResult {
  /** Lowercase hex tx hash; `null` when the settlement was ADOPTED (already `Settled` on-chain). */
  txHash: string | null;
  /** Settled ledger; `null` on the adopt path. */
  ledger: number | null;
  /** True when the escrow was already `Settled` on-chain (self-heal adopt — no tx was submitted). */
  alreadySettled: boolean;
}

export interface IOfferingEscrowService {
  /**
   * Deploy (or self-heal-adopt) the per-offering escrow contract at its deterministic address.
   * Serialized on the shared escrow-account lock; polls to closure inside the lock.
   */
  deployEscrow(input: DeployEscrowInput): Promise<DeployEscrowResult>;

  /**
   * Read the escrow's on-chain lifecycle status (TOV-160) — the authoritative self-heal oracle the settle
   * worker reads at the TOP of every attempt (never inferred from error text). Read-only (simulate).
   */
  readStatus(escrowAddress: string): Promise<OfferingEscrowStatus>;

  /**
   * `close_offering` (Open → Closed) — admin-as-source, serialized on the shared lock, polled to closure.
   * The worker calls this only when `readStatus === 'open'` (it reverts `OfferingNotOpen` otherwise).
   */
  closeOffering(input: CloseOfferingInput): Promise<{ txHash: string | null }>;

  /**
   * `close_and_settle(clearing_price, allocations)` (Closed → Settled) — atomic mint + refund-all + split.
   * Admin-as-source, serialized on the shared lock, polled to closure. If the escrow is already `Settled`
   * on-chain (crash-after-landing), returns `{ alreadySettled: true }` without submitting (adopt path).
   */
  closeAndSettle(input: CloseAndSettleInput): Promise<CloseAndSettleResult>;
}
