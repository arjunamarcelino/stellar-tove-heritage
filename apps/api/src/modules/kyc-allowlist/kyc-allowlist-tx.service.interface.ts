import { KycAllowlistAction } from './kyc-allowlist.types';

export const KYC_ALLOWLIST_TX_SERVICE = 'IKycAllowlistTxService';

/** Neutral chain-layer result for a single submission — no HTTP/SDK types leak to the orchestrator. */
export type KycAllowlistSubmitResult =
  | { status: 'confirmed'; txHash: string; ledger: number }
  | { status: 'pending'; txHash: string };

/**
 * Port for the on-chain KYCAllowlist contract (TOV-141). Reads are sequence-free and safe to run in
 * parallel; `submitOne` is serialized on the admin account lock by the adapter (one tx / account / ledger).
 */
export interface IKycAllowlistTxService {
  /** Simulate-only `is_allowed(wallet)` read. Throws when the RPC is unavailable (caller classifies). */
  isAllowed(wallet: string): Promise<boolean>;

  /**
   * Build → simulate → sign (admin == source) → send → poll-to-closure for one `add`/`remove`, under the
   * account lock. Returns `confirmed` (with ledger) or `pending` (poll timed out; tx may still land).
   * Throws on simulation/send/apply failure (caller records a `failed` item).
   */
  submitOne(action: KycAllowlistAction, wallet: string): Promise<KycAllowlistSubmitResult>;
}
