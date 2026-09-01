/**
 * Port for the Soroban relayer that deploys embedded smart wallets. The concrete
 * adapter (`SorobanRelayerService`) talks to Soroban RPC; tests use an in-memory
 * fake overridden via this token. Types stay Node-agnostic (`Uint8Array`).
 */
import type { TransferErrorReason } from './relayer.errors';

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

/**
 * Build an unsigned `OfferingEscrow.submit_bid` invocation from a bidder's embedded wallet (TOV-156).
 * Distinct from `BuildTransferInput` (a flat SAC transfer) because `submit_bid` carries a nested inner
 * `usdc.transfer(bidder → escrow)` sub-invocation — one passkey signature over the root covers both.
 */
export interface BuildBidInput {
  /** The bidder's embedded smart-wallet contract (the `bidder` + inner-transfer `from`), from the JWT. */
  walletContract: string;
  /** The offering's deployed escrow contract (root invocation target). */
  escrowContract: string;
  /** The USDC SAC contract (inner transfer target). */
  tokenContract: string;
  /** Scaled i128 price per fraction as a decimal string. */
  priceScaled: string;
  /** Scaled i128 fraction count as a decimal string. */
  count: string;
  /** The on-chain `idempotency_key` (BytesN<32>) baked into the signed tx. */
  idempotencyKey: Uint8Array;
}

export interface BuildBidResult {
  txXdr: string;
  challenge: string;
  expiresAtLedger: number;
}

/** Submit a built `submit_bid` with the round-tripped WebAuthn assertion (TOV-156). */
export interface SubmitSignedBidInput {
  txXdr: string;
  /** Server-trusted bidder wallet + escrow + token, re-checked against the signed tx. */
  walletContract: string;
  escrowContract: string;
  tokenContract: string;
  /** Exact server-trusted price/count (the verifier pins args[1]/args[2] + the inner amount to these). */
  priceScaled: string;
  count: string;
  /** Ceiling on the escrowed amount (price*count) as a decimal string. */
  maxCostScaled: string;
  /** The server-derived on-chain idempotency_key (BytesN<32>) the verifier pins args[3] to (todo 297). */
  idempotencyKey: Uint8Array;
  boundPublicKey: Uint8Array;
  credentialId: string;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
  rpId: string;
  allowedOrigins: string[];
}

export interface SubmitBidResult {
  /** Submitted transaction hash (hex). */
  txHash: string;
  /** Ledger the transaction was applied in. */
  ledger: number;
  /** Terminal status (SUCCESS). */
  status: string;
  /** The 1-based bid id returned by the escrow contract's `submit_bid`. */
  bidId: number;
}

/**
 * Build an unsigned `OfferingEscrow.cancel_bid` invocation from a bidder's embedded wallet (TOV-158).
 * Simpler than {@link BuildBidInput}: `cancel_bid(caller, bid_id)` has no amount args, and its auth tree is
 * root-only (the refund `usdc.transfer(escrow → bidder)` is authorized by the contract, not the caller).
 */
export interface BuildCancelBidInput {
  /** The bidder's smart-wallet = the recorded `bid.collector_wallet` = the on-chain `caller`. */
  caller: string;
  /** The offering's deployed escrow contract (root invocation target). */
  escrowContract: string;
  /** The on-chain `bid_id` (u32) to cancel (= the recorded `chain_bid_id`). */
  bidId: number;
}

export interface BuildCancelBidResult {
  txXdr: string;
  challenge: string;
  expiresAtLedger: number;
}

/** Submit a built `cancel_bid` with the round-tripped WebAuthn assertion (TOV-158). */
export interface SubmitSignedCancelBidInput {
  txXdr: string;
  /** Server-trusted caller (= recorded `bid.collector_wallet`) + escrow, re-checked against the signed tx. */
  caller: string;
  escrowContract: string;
  /** The server-trusted on-chain `bid_id` (u32) the verifier pins args[1] to. */
  chainBidId: number;
  boundPublicKey: Uint8Array;
  credentialId: string;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
  rpId: string;
  allowedOrigins: string[];
}

export interface SubmitCancelBidResult {
  /** Submitted transaction hash (hex). */
  txHash: string;
  /** Ledger the transaction was applied in. */
  ledger: number;
  /** Terminal status (SUCCESS). */
  status: string;
}

// ── TOV-177: two-signature MarketplaceSettler.accept_quote settlement ─────────────────────────────────────
//
// accept_quote needs TWO passkey signatures over the require_auth_for_args 5-tuple: the seller signs at the
// authorize step (`buildSellerQuoteAuth` → sign → `attachSellerQuoteAuth`, stored on the quote), the buyer
// signs at accept (`buildAcceptQuote` → sign → `submitSignedAcceptQuote`). Bytes are `Uint8Array` at the port
// boundary; BytesN<32> ids are the sha256-of-uuid values. NB: the accept submit sources/signs/locks on a
// DEDICATED marketplace-settlement account + lock when `RELAYER_MARKETPLACE_SETTLEMENT_SECRET` is set (#386),
// else falls back to the shared relayer account + shared `relayer:account:` lock (mirroring bids).

/** Common server-trusted economic tuple for the two-signature accept flow. */
export interface AcceptQuoteTuple {
  settlerContract: string;
  usdcContract: string;
  buyerWallet: string;
  sellerWallet: string;
  rfqId: Uint8Array; // BytesN<32>
  quoteId: Uint8Array; // BytesN<32>
  artworkId: Uint8Array; // BytesN<32>
  count: string; // i128 decimal string
  gross: string; // i128 decimal string (= count × price)
}

/** Build the SELLER's unsigned `accept_quote` auth entry + the challenge the seller's passkey signs. */
export interface BuildSellerQuoteAuthInput extends AcceptQuoteTuple {
  /** Signature validity = ledgers until the quote's `validUntil` (full quote lifetime, ≤168h). */
  sigValidityLedgers: number;
}
export interface BuildSellerQuoteAuthResult {
  challenge: string;
  expiresAtLedger: number;
  /** The unsigned seller `SorobanAuthorizationEntry` (base64 XDR) the client round-trips back to attach. */
  sellerAuthEntryXdr: string;
}

/** Verify the seller's signed assertion + attach the OZ AuthPayload → the stored, replay-ready seller entry. */
export interface AttachSellerQuoteAuthInput extends AcceptQuoteTuple {
  sellerAuthEntryXdr: string;
  boundPublicKey: Uint8Array;
  credentialId: string;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
  rpId: string;
  allowedOrigins: string[];
}
export interface AttachSellerQuoteAuthResult {
  /** The signed seller `SorobanAuthorizationEntry` (base64 XDR), persisted on the quote. */
  signedEntryXdr: string;
  /** The entry's `signatureExpirationLedger` (persisted as `seller_auth_expires_ledger`). */
  expiresAtLedger: number;
}

/** Build the BUYER's OWN unsigned `accept_quote` auth entry + the challenge the buyer's passkey signs. */
export interface BuildAcceptQuoteInput extends AcceptQuoteTuple {
  /** Short buyer-signature validity (~120 ledgers ≈ 10 min); the buyer submits promptly. */
  sigValidityLedgers: number;
}
export interface BuildAcceptQuoteResult {
  challenge: string;
  expiresAtLedger: number;
  /** The buyer's OWN unsigned entry (base64 XDR) — NOT a tx with the seller entry (which stays server-side). */
  buyerAuthEntryXdr: string;
}

/** The total outcome of an on-chain accept_quote submission (never thrown for an expected chain result). */
export type AcceptQuoteOutcome =
  | { status: 'SUCCESS'; txHash: string; ledger: number }
  | { status: 'REVERTED'; contractCode: number | null } // on-chain Error(Contract,#n); is_settled decides adopt-vs-fail
  // expired | signature_* | transfer_failed | unavailable. `expiredParty` disambiguates a `reason:'expired'` so
  // the classifier can expire the quote on a lapsed SELLER auth (re-authorize) vs keep it open on a lapsed BUYER
  // signature (re-prepare) — TOV-177 #389. Absent for non-expiry reasons.
  | { status: 'RELAYER_FAILED'; reason: TransferErrorReason; expiredParty?: 'buyer' | 'seller' };

/** Combine the buyer's signed entry with the stored seller entry and submit the two-signature accept_quote. */
export interface SubmitSignedAcceptQuoteInput extends AcceptQuoteTuple {
  /** The buyer's own unsigned entry (from `buildAcceptQuote`). */
  buyerAuthEntryXdr: string;
  /** The signed seller entry fetched server-side from the quote row (NEVER supplied by the buyer). */
  storedSellerEntryXdr: string;
  boundPublicKey: Uint8Array;
  credentialId: string;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
  rpId: string;
  allowedOrigins: string[];
}

/**
 * NB (todo 307): this port intentionally AGGREGATES every passkey-signed money flow — wallet deploy,
 * USDC transfer + holdings read (TOV-22/40), and bid escrow (TOV-156) — behind ONE adapter. That is an
 * ISP trade-off made on purpose: all flows share a single relayer keypair and the single serialized
 * `relayer:account:${pubkey}` send-lock, so splitting the interface would fragment that lock across tokens
 * without decoupling anything at runtime. Do not "fix" the fat interface by splitting it.
 */
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

  /**
   * Build an unsigned `OfferingEscrow.submit_bid` invocation + the WebAuthn challenge the bound passkey
   * must sign (TOV-156). Mirrors `buildTransfer`, but the op is a `submit_bid` whose simulated auth tree
   * carries the inner `usdc.transfer` sub-invocation; the returned challenge commits to the full tree.
   * Throws `RelayerTransferError('simulation_failed')` on a failed simulation.
   */
  buildBid(input: BuildBidInput): Promise<BuildBidResult>;

  /**
   * Assert a prepared bid tx's passkey signature has NOT expired (TOV-156): parse `txXdr` for the auth
   * entry's `signatureExpirationLedger` and compare it (with a TOCTOU margin) to the current ledger. A
   * cheap fail-fast so `/submit` can reject a stale signature (→ `BID_CHALLENGE_EXPIRED`, re-prepare)
   * BEFORE recording a bid, rather than the escrow landing `failed` asynchronously. Throws
   * `RelayerTransferError('expired')` when expired, `('signature_invalid')` on a malformed tx.
   */
  assertBidNotExpired(txXdr: string): Promise<void>;

  /**
   * Verify the round-tripped passkey assertion (fail-closed, no RPC: `verifyBidAuthorization` — exact-pins
   * price/count + the inner escrow amount, rejects SOURCE_ACCOUNT creds) and — only if valid — attach the
   * OZ `AuthPayload`, rebuild the envelope with a FRESH relayer sequence (the passkey digest does not
   * cover the tx sequence), re-simulate, fee-cap, relayer-sign, and submit. Returns the contract's bid id.
   * Throws a terminal `RelayerTransferError` the caller maps to a `BID_*` code.
   */
  submitSignedBid(input: SubmitSignedBidInput): Promise<SubmitBidResult>;

  /**
   * Build an unsigned `OfferingEscrow.cancel_bid` invocation + the WebAuthn challenge the bound passkey must
   * sign (TOV-158). Mirrors `buildBid` but the op is a root-only `cancel_bid` (no sub-invocation). Throws
   * `RelayerTransferError('simulation_failed')` on a failed simulation (e.g. the offering is no longer Open).
   */
  buildCancelBid(input: BuildCancelBidInput): Promise<BuildCancelBidResult>;

  /**
   * Verify the round-tripped passkey assertion (fail-closed, no RPC: `verifyCancelBidAuthorization` — exact-
   * pins escrow/caller/bid_id, asserts NO sub-invocations, rejects SOURCE_ACCOUNT creds) and — only if valid
   * — attach the OZ `AuthPayload`, re-simulate, fee-cap, relayer-sign, and submit. Returns the terminal
   * status. `cancel_bid` returns void → no `bidId`. Throws a terminal `RelayerTransferError` the caller/worker
   * maps to a `BID_*` code / classifier bucket. NB: expiry re-check reuses `assertBidNotExpired` (fn-agnostic).
   */
  submitSignedCancelBid(input: SubmitSignedCancelBidInput): Promise<SubmitCancelBidResult>;

  /**
   * Build the SELLER's unsigned `accept_quote` auth entry + the challenge the seller's passkey signs (TOV-177,
   * authorize step). Simulates the two-signature `accept_quote`, extracts the seller's (root-only) auth entry,
   * and sets its expiry to the full quote lifetime. Throws `RelayerTransferError('simulation_failed')`.
   */
  buildSellerQuoteAuth(input: BuildSellerQuoteAuthInput): Promise<BuildSellerQuoteAuthResult>;

  /**
   * Verify the seller's round-tripped assertion (fail-closed) and attach the OZ AuthPayload → the signed
   * seller entry persisted on the quote and replayed at accept. Throws a terminal `RelayerTransferError`.
   */
  attachSellerQuoteAuth(input: AttachSellerQuoteAuthInput): Promise<AttachSellerQuoteAuthResult>;

  /**
   * Build the BUYER's OWN unsigned `accept_quote` auth entry + the buyer challenge (TOV-177, accept step).
   * Returns ONLY the buyer entry — the signed seller entry stays server-side (a buyer holding both could
   * bypass the DB gates). Throws `RelayerTransferError('simulation_failed')`.
   */
  buildAcceptQuote(input: BuildAcceptQuoteInput): Promise<BuildAcceptQuoteResult>;

  /**
   * Cheap fail-fast for `/accept`: assert the buyer's prepared auth entry has not expired (TOCTOU margin).
   * Throws `RelayerTransferError('expired')` / `('signature_invalid')`.
   */
  assertAcceptQuoteNotExpired(buyerAuthEntryXdr: string): Promise<void>;

  /**
   * Combine the buyer's signed entry with the stored seller entry, verify (two-entry, fail-closed), enforcing
   * re-simulate, fee-cap, relayer-sign, and submit the two-signature `accept_quote` (TOV-177, settle worker).
   * Returns a TOTAL {@link AcceptQuoteOutcome} union (never throws for an expected chain/relayer result) so the
   * worker's `is_settled`-gated classifier drives adopt-vs-terminal-fail without try/catch control flow.
   */
  submitSignedAcceptQuote(input: SubmitSignedAcceptQuoteInput): Promise<AcceptQuoteOutcome>;
}
