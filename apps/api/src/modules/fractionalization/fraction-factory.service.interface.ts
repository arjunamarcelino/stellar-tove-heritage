import { TokenInitInput } from './token-init';

export const FRACTION_FACTORY_SERVICE = 'IFractionFactoryService';

export interface DeployFractionTokenInput {
  /** Salt source (sha256 → BytesN<32>) and factory registry key. */
  artworkId: string;
  init: TokenInitInput;
  /** Invoked with the tx hash immediately before submit, so the caller can persist it for retry/audit. */
  onTxHash?: (txHash: string) => Promise<void>;
}

export interface DeployFractionTokenResult {
  tokenAddress: string;
  /** Empty on the self-heal path (no submit happened this call). */
  txHash: string;
  /** Null when unrecoverable (self-heal/reconcile: the token exists but the deploy ledger is lost). */
  deployLedger: string | null;
}

/**
 * Port for the on-chain FractionTokenFactory (TOV-137). Distinct from the passkey `RELAYER_SERVICE`
 * (the wallet-money port) so fraction-specific types never leak into transfer/export consumers.
 */
export interface IFractionFactoryService {
  /** Registry read (`factory.token_of`) — the self-heal/reconcile idempotency oracle. */
  tokenOf(artworkId: string): Promise<string | null>;
  /** Build + admin-authorize + submit `factory.deploy(TokenInit)`; returns the deployed token address. */
  deployFractionToken(input: DeployFractionTokenInput): Promise<DeployFractionTokenResult>;
}
