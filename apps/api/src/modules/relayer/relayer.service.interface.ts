/**
 * Port for the Soroban relayer that deploys embedded smart wallets. The concrete
 * adapter (`SorobanRelayerService`) talks to Soroban RPC; tests use an in-memory
 * fake overridden via this token. Types stay Node-agnostic (`Uint8Array`).
 */
export const RELAYER_SERVICE = 'IRelayerService';

export interface DeployPasskeyWalletInput {
  /** WebAuthn credential id (base64url) — the deterministic-salt / idempotency key. */
  credentialId: string;
  /** Raw uncompressed secp256r1/P-256 public key: 0x04 || x(32) || y(32) = 65 bytes. */
  secp256r1PublicKey: Uint8Array;
}

export interface DeployPasskeyWalletResult {
  /** Deployed Soroban contract address (C-StrKey). */
  contractAddress: string;
  /**
   * Submitted transaction hash (hex), or `''` for an idempotent no-op — i.e. the wallet already
   * existed on-chain and was resolved to its derived address without a new submission (self-heal).
   */
  txHash: string;
}

/** Build an unsigned USDC transfer from an embedded smart wallet (TOV-22). */
export interface BuildTransferInput {
  /** The caller's embedded smart-wallet contract (the transfer `from`), resolved from the JWT. */
  walletContract: string;
  /** The token (USDC SAC) contract the transfer invokes. */
  tokenContract: string;
  /** Recipient address (G- or C-StrKey). */
  to: string;
  /** Scaled i128 amount as a decimal string. */
  amountScaled: string;
}

export interface BuildTransferResult {
  /** Unsigned transfer transaction (base64 XDR) — carries the wallet's auth entry, signature void. */
  txXdr: string;
  /** WebAuthn challenge to sign: base64url of the OZ auth-digest. */
  challenge: string;
  /** Ledger sequence after which the passkey signature expires. */
  expiresAtLedger: number;
}

/** Read a wallet contract's balance of one or more tokens (read-only simulate; TOV-40 export). */
export interface ReadWalletHoldingsInput {
  /** The embedded smart-wallet contract whose balances to read. */
  walletContract: string;
  /** Token (SAC/SEP-41) contracts to read `balance(walletContract)` for. */
  tokenContracts: string[];
}

/** A wallet's balance of one token. `amountScaled` is the raw i128 as a decimal string (may be "0"). */
export interface WalletHolding {
  tokenContract: string;
  amountScaled: string;
}

/** Submit a built transfer with the round-tripped WebAuthn assertion (TOV-22). Node-agnostic bytes. */
export interface SubmitSignedTransferInput {
  txXdr: string;
  /** Server-trusted `from` wallet (owner-scoped) + token, re-checked against the tx. */
  walletContract: string;
  tokenContract: string;
  /**
   * Export only (TOV-40): pin the recipient + exact amount to server-trusted values (the frozen export
   * item), so a self-built tx can't redirect funds off the allowlisted target or change the amount.
   * Omitted by the single transfer surface (TOV-22), which leaves the user free to choose `to`.
   */
  expectedTo?: string;
  expectedAmountScaled?: string;
  /** Bound passkey: raw P-256 (65 bytes) + credential id (for the OZ signer key_data). */
  boundPublicKey: Uint8Array;
  credentialId: string;
  /** WebAuthn assertion fields (raw bytes; signature is DER, low-S normalized before submit). */
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
  rpId: string;
  allowedOrigins: string[];
  /** Per-transfer amount ceiling (scaled i128 as a decimal string), re-enforced before submit. */
  maxTransferAmount: string;
}

export interface SubmitTransferResult {
  /** Submitted transaction hash (hex). */
  txHash: string;
  /** Ledger the transaction was applied in. */
  ledger: number;
  /** Terminal status (SUCCESS). */
  status: string;
}

export interface IRelayerService {
  /**
   * Deploy a smart-wallet contract bound to the passkey key. Idempotent: the same
   * credentialId yields the same (deterministic) contract address, and an
   * already-deployed address resolves to success. Throws on unrecoverable failure
   * (the caller maps that to WALLET_DEPLOY_FAILED).
   */
  deployPasskeyWallet(input: DeployPasskeyWalletInput): Promise<DeployPasskeyWalletResult>;

  /**
   * Build an unsigned USDC transfer + the exact WebAuthn challenge the bound passkey must sign
   * (base64url of the OZ auth-digest). The relayer is the tx source/fee-payer only; the wallet's
   * authorization is a passkey auth entry the caller signs on-device and returns to submit. Throws
   * on a failed simulation (the caller maps that to TRANSFER_SIMULATION_FAILED).
   *
   * The user's device signs the returned `challenge`; `submitSignedTransfer` then verifies + submits.
   */
  buildTransfer(input: BuildTransferInput): Promise<BuildTransferResult>;

  /**
   * Read a wallet contract's balance of each token via read-only simulation of `token.balance(wallet)`
   * (no lock, no submission). Throws a terminal `RelayerTransferError('unavailable')` if any single
   * balance read fails — the caller must not silently drop a holding from an export. TOV-40.
   */
  readWalletHoldings(input: ReadWalletHoldingsInput): Promise<WalletHolding[]>;

  /**
   * Verify the round-tripped passkey assertion (fail-closed: presence, op↔auth-entry binding,
   * challenge/UV/origin, low-S secp256r1 vs the bound key) and — only if valid — attach the OZ
   * `AuthPayload`, re-simulate, relayer-sign the envelope, and submit. NEVER submits without a valid
   * signature. Throws a terminal `RelayerTransferError` (`signature_required`/`signature_invalid`/
   * `expired`/`simulation_failed`/`transfer_failed`/`unavailable`) that the caller maps to an errorCode.
   */
  submitSignedTransfer(input: SubmitSignedTransferInput): Promise<SubmitTransferResult>;
}
