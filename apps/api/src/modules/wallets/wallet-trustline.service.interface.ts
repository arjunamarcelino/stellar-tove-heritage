export const WALLET_TRUSTLINE_SERVICE = 'IWalletTrustlineService';

export interface TrustlineAsset {
  code: string;
  issuer: string;
}

export interface TrustlineInstruction {
  /** Base64 unsigned transaction carrying a single `change_trust` op (seq=0 template). */
  changeTrustXdr: string;
  asset: TrustlineAsset;
}

/**
 * Read-only port that resolves whether a BYOW (classic G-account) wallet needs a USDC trustline
 * (TOV-32, FR-01.11). Kept distinct from the money-path `RELAYER_SERVICE` and the balance-read
 * `FRACTION_READ_SERVICE`: it signs nothing and reads a single classic ledger entry. Tests override
 * the token with an in-memory fake.
 *
 * The embedded (Soroban contract) wallet never uses this — a contract holds SAC-USDC internally with
 * no classic trustline, so only BYOW binds are resolved.
 */
export interface IWalletTrustlineService {
  /**
   * `null`  => the account already trusts USDC (authorized) — omit the instruction.
   * value   => the account should establish the trustline — include the instruction.
   *
   * TOTAL: this method never throws (not even on RPC failure). This is load-bearing — the resolve
   * runs AFTER `idempotency.complete()` on both the fresh and replay paths of the wallet-add flow, so
   * a throw would strand an already-bound, already-completed wallet behind a 500 on every retry. On
   * any failure it fails open and returns a best-effort `seq=0` template. Do NOT "fix" this into the
   * throwing `FRACTION_READ_SERVICE` shape.
   */
  resolveUsdcTrustline(publicKey: string): Promise<TrustlineInstruction | null>;
}
