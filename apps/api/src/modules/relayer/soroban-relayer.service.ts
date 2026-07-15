import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import {
  rpc,
  Keypair,
  Contract,
  Address,
  TransactionBuilder,
  StrKey,
  xdr,
  nativeToScVal,
  scValToBigInt,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { relayerConfig } from '@config/relayer.config';
import {
  DeployPasskeyWalletInput,
  DeployPasskeyWalletResult,
  BuildTransferInput,
  BuildTransferResult,
  SubmitSignedTransferInput,
  SubmitTransferResult,
  ReadWalletHoldingsInput,
  WalletHolding,
  IRelayerService,
} from './relayer.service.interface';
import { RELAYER_ACCOUNT_LOCK, IRelayerAccountLock } from './relayer-account-lock.interface';
import { deriveSalt, buildKeyData } from './signer-encoding';
import { deriveWalletAddress } from './wallet-address';
import {
  computeHostPayloadHash,
  computeAuthDigest,
  encodeAuthPayloadScVal,
  DEFAULT_CONTEXT_RULE_ID,
} from './auth-entry-encoding';
import { verifyPasskeyAuthorization } from './passkey-authorization';
import { RelayerTransferError } from './relayer.errors';

// Poll interval is an operational constant; the poll loop is bounded by the
// config wall-clock deadline `deployTimeoutMs` (deadline-driven, not attempt-count).
const POLL_INTERVAL_MS = 1000;
// Ceiling on any single relayer RPC call, so one hung call can't blow the lock TTL / poll deadline.
const RPC_TIMEOUT_MS = 5000;
// Crash-safety ceiling on the deploy lock hold. Sized above the in-lock critical section: at most
// three sequential RPCs (getAccount + prepareTransaction + sendTransaction), each ≤ RPC_TIMEOUT_MS,
// so 3 × 5s = 15s < 20s with margin. The poll runs OUTSIDE the lock.
const LOCK_TTL_MS = 20000;
// Bounded transparent retries for a retryable deploy race (stale sequence txBAD_SEQ, or an RPC
// throttle TRY_AGAIN_LATER): the relayer is one keypair = one sequence, and `getAccount` reads the
// last-closed ledger, so two deploys within a ledger-close window can build the same sequence. Each
// retry re-fetches the sequence.
const MAX_DEPLOY_RETRIES = 3;
// Passkey signature validity window (ledgers, ~5s each) for a transfer. Deliberately tight for a
// money surface — it bounds the build→submit replay/fee-exposure window (re-checked at submit).
const SIG_VALIDITY_LEDGERS = 40;
// TOCTOU safety margin: reject a signature that would expire within this many ledgers of submit. Sized
// to cover the lock-wait + send window (~SUBMIT_LOCK_TTL_MS ≈ 2 ledgers, plus slack) so a just-valid tx
// isn't included-then-failed (burning a fee) as ledgers close between the check and the send.
const EXPIRY_MARGIN_LEDGERS = 4;
// Crash-safety ceiling on the transfer send lock. The submit critical section is exactly one bounded
// `sendTransaction` (≤ RPC_TIMEOUT_MS) + CPU signing, so ~10s (2× RPC_TIMEOUT_MS) is ample — smaller
// than the deploy lock (three RPCs) to shorten the worst-case stall on the shared relayer sequence.
// The poll runs OUTSIDE the lock. The Redis lock's own acquisition wait is bounded at 2× this TTL.
const SUBMIT_LOCK_TTL_MS = 10000;
// A freshly-submitted tx can't be applied before the next ledger closes (~5s), so delay the first
// poll to skip the guaranteed-NOT_FOUND calls, then poll at POLL_INTERVAL_MS.
const FIRST_POLL_DELAY_MS = 2000;
// Signed 128-bit max (2^127 - 1) — a transfer amount must be a positive i128.
const I128_MAX = (1n << 127n) - 1n;
// The `TransactionResultCode` XDR enum name for a stale-sequence rejection (a stable discriminant,
// unlike host-error text). Named so a silent SDK enum-casing change is a single point of maintenance.
const TX_BAD_SEQ = 'txBadSeq';

/** Sentinel base: a transient, transparently-retryable deploy failure (race, not a genuine error). */
class RetryableDeployError extends Error {}

/** The deploy failed with a stale sequence (txBAD_SEQ). */
class SequenceError extends RetryableDeployError {
  constructor() {
    super('relayer deploy failed: stale sequence (txBAD_SEQ) after retries');
    this.name = 'SequenceError';
  }
}

/** `sendTransaction` was throttled (TRY_AGAIN_LATER). */
class ThrottledError extends RetryableDeployError {
  constructor() {
    super('relayer deploy failed: sendTransaction throttled (TRY_AGAIN_LATER) after retries');
    this.name = 'ThrottledError';
  }
}

/**
 * Deploys embedded smart wallets by invoking
 * `FractionWalletFactory.deploy_wallet(wasm_hash, salt, signers, policies)` on Soroban,
 * paid + signed by the relayer account. The single passkey signer is
 * `Signer::External(webauthnVerifier, key_data)` where
 * `key_data = secp256r1PublicKey(65) ‖ rawCredentialId` and `salt = sha256(rawCredentialId)`
 * (byte-identical to smart-account-kit, so the FE derives the same wallet address).
 *
 * Submissions are SERIALIZED per relayer account via a distributed lock (one keypair =
 * one sequence number; concurrent submits collide -> txBAD_SEQ). The lock covers only the
 * sequence-fetch -> submit critical section; the poll runs outside it. Because the lock releases
 * at submit (before ledger-apply) a stale-sequence txBAD_SEQ is still possible under load, so it is
 * transparently retried (re-fetch the sequence + resubmit, bounded by MAX_SEQ_RETRIES).
 *
 * IDEMPOTENT SELF-HEAL: the salt is deterministic, so the wallet address is a pure function
 * of the passkey. We (1) derive it off-chain and skip deploying if it already exists, and
 * (2) on ANY deploy failure re-check on-chain existence — a deterministic-salt collision
 * (concurrent double-submit, or a crash-recovered retry) means the wallet now exists, so we
 * self-heal to the derived address. On-chain state is authoritative; we never infer "already
 * exists" from error text. A deploy that succeeded on-chain but whose DB bind rolled back is
 * thus retryable.
 *
 * NOTE: the off-chain derivation assumes the factory deploys via `env.deployer()
 * .with_current_contract(salt)` (deployer = the FACTORY contract). Fresh deploys use the
 * authoritative returned Address; a `returned !== derived` mismatch is logged (the
 * existence-check optimization would be unreliable) — verified by the live-testnet test.
 */
@Injectable()
export class SorobanRelayerService implements IRelayerService {
  private readonly logger = new Logger(SorobanRelayerService.name);
  private readonly server: rpc.Server;
  private readonly relayer: Keypair;

  constructor(
    @Inject(relayerConfig.KEY)
    private readonly cfg: ConfigType<typeof relayerConfig>,
    @Inject(RELAYER_ACCOUNT_LOCK)
    private readonly lock: IRelayerAccountLock,
  ) {
    this.server = new rpc.Server(this.cfg.rpcUrl);
    this.relayer = Keypair.fromSecret(this.cfg.relayerSecret);
  }

  async deployPasskeyWallet(
    input: DeployPasskeyWalletInput,
  ): Promise<DeployPasskeyWalletResult> {
    // Config presence (wasm hash + factory/verifier addresses) is enforced fast at boot by the Joi
    // schema (required + StrKey/hex shape), so no per-request guard is needed here.
    const salt = deriveSalt(input.credentialId); // sha256(rawCredentialId) — matches smart-account-kit
    const derived = deriveWalletAddress(this.cfg.factoryAddress, salt, this.cfg.networkPassphrase);

    // (1) Sequential-retry self-heal: skip the deploy if the wallet already exists.
    if (await this.walletExists(derived)) {
      this.logger.log(`Embedded smart wallet already deployed [contract=${derived}]`);
      return { contractAddress: derived, txHash: '' };
    }

    // (2) Deploy (serialized), retrying transparently on a stale-sequence collision.
    for (let attempt = 0; ; attempt++) {
      try {
        const txHash = await this.lock.withLock(
          `relayer:account:${this.relayer.publicKey()}`,
          LOCK_TTL_MS,
          () => this.buildAndSubmit(input, salt),
        );
        const result = await this.pollForResult(txHash); // outside the lock
        if (result.switch() !== xdr.ScValType.scvAddress()) {
          throw new Error('relayer deploy returned an unexpected value (not a contract address)');
        }
        const contractAddress = StrKey.encodeContract(Address.fromScAddress(result.address()).toBuffer());
        if (contractAddress !== derived) {
          this.logger.warn(
            `deploy address drift: returned=${contractAddress} derived=${derived} ` +
              '(off-chain derivation off; existence-check self-heal is unreliable)',
          );
        }
        this.logger.log(`Deployed embedded smart wallet [contract=${contractAddress} tx=${txHash}]`);
        return { contractAddress, txHash };
      } catch (err) {
        // On-chain state is authoritative: a deterministic-salt collision (concurrent double-submit,
        // or a crash-recovered retry) means the wallet now exists — self-heal to the derived address
        // rather than surfacing a 503.
        if (await this.walletExists(derived)) {
          this.logger.log(`Embedded smart wallet already existed; self-healing [contract=${derived}]`);
          return { contractAddress: derived, txHash: '' };
        }
        // A retryable race (stale sequence txBAD_SEQ, or an RPC throttle) is not a genuine failure:
        // re-fetch the sequence and resubmit after a short backoff, bounded so a persistent problem
        // still surfaces.
        if (err instanceof RetryableDeployError && attempt < MAX_DEPLOY_RETRIES) {
          this.logger.warn(`relayer deploy retrying after ${err.name} [attempt=${attempt + 1}]`);
          await this.sleep(POLL_INTERVAL_MS);
          continue;
        }
        throw err instanceof Error ? err : new Error('relayer deploy failed');
      }
    }
  }

  /**
   * Build an unsigned USDC transfer from an embedded wallet + the exact WebAuthn challenge the bound
   * passkey must sign. The relayer is source/fee-payer only; the wallet's authorization is a passkey
   * auth entry the caller signs on-device. Read-only (simulate + getLatestLedger), so NO lock.
   *
   * ⚠️ The challenge is `base64url(OZ auth_digest)` and the resulting auth-entry format targets
   * OpenZeppelin `stellar-accounts` v0.7.2 (verified against tove-contract@dev, byte-for-byte vs the
   * TOV-39 golden vector). NOT YET VERIFIED against the DEPLOYED wallet: the digest binding + the
   * `context_rule_ids=[0]` assumption need the gated `RELAYER_LIVE_TESTNET` transfer test
   * (`testnet-transfer.integration.spec.ts`) run against a funded wallet. See the plan.
   */
  async buildTransfer(input: BuildTransferInput): Promise<BuildTransferResult> {
    // Re-assert the amount is a positive i128 at the port boundary (the service scales + bounds it,
    // but the port shouldn't trust a raw string caller).
    let amount: bigint;
    try {
      amount = BigInt(input.amountScaled);
    } catch {
      throw new RelayerTransferError('simulation_failed', 'invalid amount');
    }
    if (amount <= 0n || amount > I128_MAX) {
      throw new RelayerTransferError('simulation_failed', 'amount out of i128 range');
    }

    const account = await this.withTimeout('getAccount', this.server.getAccount(this.relayer.publicKey()));

    const op = new Contract(input.tokenContract).call(
      'transfer',
      Address.fromString(input.walletContract).toScVal(), // from = the embedded wallet
      Address.fromString(input.to).toScVal(), // to
      nativeToScVal(amount, { type: 'i128' }), // amount: i128
    );
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.cfg.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    // simulate and getLatestLedger are independent (the ledger seq only feeds the expiry), so run
    // them concurrently — one RTT saved on the money-critical build path.
    const [sim, latest] = await Promise.all([
      this.withTimeout('simulateTransaction', this.server.simulateTransaction(tx)),
      this.withTimeout('getLatestLedger', this.server.getLatestLedger()),
    ]);
    if (!rpc.Api.isSimulationSuccess(sim)) {
      this.logger.warn('relayer transfer simulation failed');
      throw new RelayerTransferError('simulation_failed');
    }
    // The wallet authorizes itself, so simulation surfaces one address-credentials auth entry.
    const authEntry = (sim.result?.auth ?? []).find(
      (entry) =>
        entry.credentials().switch() === xdr.SorobanCredentialsType.sorobanCredentialsAddress(),
    );
    if (!authEntry) {
      this.logger.warn('relayer transfer simulation returned no wallet auth entry');
      throw new RelayerTransferError('simulation_failed');
    }

    const expiresAtLedger = latest.sequence + SIG_VALIDITY_LEDGERS;

    // Bind the expiry into the entry BEFORE hashing, so the signed digest covers what we submit.
    const addressCreds = authEntry.credentials().address();
    addressCreds.signatureExpirationLedger(expiresAtLedger);

    const hostPayload = computeHostPayloadHash(
      this.cfg.networkPassphrase,
      addressCreds.nonce(),
      expiresAtLedger,
      authEntry.rootInvocation(),
    );
    const challenge = computeAuthDigest(hostPayload, [DEFAULT_CONTEXT_RULE_ID]).toString('base64url');

    // Attach the (unsigned) auth entry to the op so assembleTransaction preserves it (it ignores the
    // simulation's own auth when the tx already carries auth) and applies only resource/fee data.
    const operation = tx.operations[0];
    if (operation.type === 'invokeHostFunction') {
      operation.auth = [authEntry];
    }
    const assembled = rpc.assembleTransaction(tx, sim).build();

    return { txXdr: assembled.toXDR(), challenge, expiresAtLedger };
  }

  /**
   * Read a wallet contract's balance of each token via read-only simulation of `token.balance(wallet)`.
   * No lock, no submission, no relayer funds spent — the relayer account is only a simulation source.
   * Reads run concurrently; any single failed read throws `unavailable` so an export never silently
   * drops a holding. A `restorePreamble` (archived, state-expired entry) is logged: the value still
   * reads, but the later per-item transfer will need a RestoreFootprint (surfaced then as a per-item
   * simulation failure). TOV-40.
   */
  async readWalletHoldings(input: ReadWalletHoldingsInput): Promise<WalletHolding[]> {
    const account = await this.withTimeout(
      'getAccount',
      this.server.getAccount(this.relayer.publicKey()),
    );
    return Promise.all(
      input.tokenContracts.map(async (tokenContract): Promise<WalletHolding> => {
        const op = new Contract(tokenContract).call(
          'balance',
          Address.fromString(input.walletContract).toScVal(),
        );
        const tx = new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase: this.cfg.networkPassphrase,
        })
          .addOperation(op)
          .setTimeout(30)
          .build();
        const sim = await this.withTimeout('simulateTransaction', this.server.simulateTransaction(tx));
        // isSimulationSuccess is the read-succeeded discriminator: a successful `0` is a genuine zero
        // balance; a failure/absent retval is a READ failure — never coerce it to 0.
        if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) {
          this.logger.warn(`relayer balance read failed [token=${tokenContract}]`);
          throw new RelayerTransferError('unavailable', 'balance read failed');
        }
        // `restorePreamble` is only present on the restore-response variant; read it defensively.
        if ((sim as { restorePreamble?: unknown }).restorePreamble) {
          this.logger.warn(`balance entry archived (restore needed before transfer) [token=${tokenContract}]`);
        }
        return { tokenContract, amountScaled: scValToBigInt(sim.result.retval).toString() };
      }),
    );
  }

  /**
   * Verify the passkey assertion + submit the transfer. Fail-closed: `verifyPasskeyAuthorization`
   * (presence, op↔auth-entry binding, challenge/UV/origin, low-S secp256r1 vs the bound key) and the
   * expiry re-check run BEFORE any lock; a consumed-nonce/invalid/insufficient tx is caught for free by
   * the pre-send re-simulation; the fee is re-derived + capped (never trust the round-tripped fee); the
   * relayer signs the envelope only. `sendTransaction` is never reached without a valid signature.
   *
   * ⚠️ The chain orchestration (re-simulate → assemble → send → poll) is verifiable only against a
   * live wallet — covered by the gated `RELAYER_LIVE_TESTNET` test in
   * `test/integration/modules/relayer/testnet-transfer.integration.spec.ts` (skipped in CI, needs a
   * funded wallet). The verification + AuthPayload encoding are unit-tested (incl. the TOV-39 golden vector).
   */
  async submitSignedTransfer(input: SubmitSignedTransferInput): Promise<SubmitTransferResult> {
    // (1) Fail-closed verification — pure, no RPC, before the lock. Throws RelayerTransferError.
    const verified = verifyPasskeyAuthorization({
      txXdr: input.txXdr,
      networkPassphrase: this.cfg.networkPassphrase,
      walletContract: input.walletContract,
      tokenContract: input.tokenContract,
      contextRuleIds: [DEFAULT_CONTEXT_RULE_ID],
      boundPublicKey: input.boundPublicKey,
      authenticatorData: input.authenticatorData,
      clientDataJSON: input.clientDataJSON,
      signatureDer: input.signature,
      rpId: input.rpId,
      allowedOrigins: input.allowedOrigins,
      maxTransferAmount: input.maxTransferAmount,
      expectedTo: input.expectedTo,
      expectedAmountScaled: input.expectedAmountScaled,
    });

    // (2) Expiry re-check (fail before any fee), with a TOCTOU margin.
    const latest = await this.withTimeout('getLatestLedger', this.server.getLatestLedger());
    if (verified.signatureExpirationLedger <= latest.sequence + EXPIRY_MARGIN_LEDGERS) {
      throw new RelayerTransferError('expired');
    }

    // (3) Encode the OZ AuthPayload from the verified assertion and attach it to the auth entry.
    const authPayload = encodeAuthPayloadScVal({
      verifierAddress: this.cfg.webauthnVerifierAddress,
      keyData: buildKeyData(input.boundPublicKey, input.credentialId),
      signature: verified.signatureCompact,
      authenticatorData: input.authenticatorData,
      clientDataJSON: input.clientDataJSON,
      contextRuleIds: [DEFAULT_CONTEXT_RULE_ID],
    });
    // Attach the signature to the SAME auth entry verification already parsed + validated (a live
    // reference into `verified.tx`) — one parse, one mutation target, so verification and submission
    // can't diverge.
    verified.authEntry.credentials().address().signature(authPayload);
    const tx = verified.tx;

    // (4) Re-simulate with the signed auth (B2): consumed nonce / bad sig / low balance is refused here
    // for free (sendTransaction never called); resource fees are re-derived for the signed size.
    const sim = await this.withTimeout('simulateTransaction', this.server.simulateTransaction(tx));
    if (!rpc.Api.isSimulationSuccess(sim)) {
      // Off-chain verification already passed, so a chain-side failure here is a consumed nonce
      // (replay), insufficient balance, OR — worth calling out for observability — the stored DB
      // credential having drifted from the on-chain bound signer (e.g. a future key rotation).
      this.logger.warn(
        'relayer transfer re-simulation failed after off-chain verify passed ' +
          '(replay / insufficient balance / DB credential drift from the on-chain signer)',
      );
      throw new RelayerTransferError('simulation_failed');
    }
    // (5) Fee cap (B1): never sign a fee the server didn't derive + bound.
    const totalFee = BigInt(sim.minResourceFee) + BigInt(BASE_FEE);
    if (totalFee > BigInt(this.cfg.maxTxFeeStroops)) {
      this.logger.warn(`relayer transfer fee ${totalFee} exceeds cap ${this.cfg.maxTxFeeStroops}`);
      throw new RelayerTransferError('signature_invalid', 'fee exceeds cap');
    }

    const prepared = rpc.assembleTransaction(tx, sim).build();

    // (6) Serialize the send critical section per relayer account (one keypair = one sequence). Reuses
    // the generic RELAYER_ACCOUNT_LOCK token; the poll runs OUTSIDE the lock. NOTE: this single shared
    // sequence caps effective relayer throughput at ~1 tx per ledger-close (~0.2 TPS) system-wide — an
    // operational SLO limit; scaling past it needs channel/fee-bump accounts or sequence pipelining.
    const txHash = await this.lock.withLock(
      `relayer:account:${this.relayer.publicKey()}`,
      SUBMIT_LOCK_TTL_MS,
      async () => {
        prepared.sign(this.relayer);
        const sent = await this.withTimeout('sendTransaction', this.server.sendTransaction(prepared));
        switch (sent.status) {
          case 'PENDING':
          case 'DUPLICATE':
            return sent.hash;
          case 'TRY_AGAIN_LATER':
            this.logger.warn('relayer transfer send throttled [TRY_AGAIN_LATER]');
            throw new RelayerTransferError('unavailable');
          default:
            // A stale-sequence collision (txBAD_SEQ) is transient, not a real failure: a concurrent
            // sequence-consuming op on the shared relayer account can release the lock before
            // ledger-apply. Surface it as retryable (503) so the FE re-/builds, not a terminal 502.
            // (The signed envelope bakes in the sequence, so the server can't rebuild+resend.)
            if (this.isSequenceError(sent.errorResult)) {
              this.logger.warn('relayer transfer send hit a stale sequence [txBAD_SEQ]');
              throw new RelayerTransferError('unavailable');
            }
            this.logger.warn(`relayer transfer send rejected [status=${sent.status}]`);
            throw new RelayerTransferError('transfer_failed');
        }
      },
    );

    const applied = await this.pollForTransfer(txHash); // outside the lock
    return { txHash, ledger: applied.ledger, status: 'SUCCESS' };
  }

  /** Poll getTransaction until SUCCESS (a SAC transfer returns void — key off status, not a value). */
  private async pollForTransfer(hash: string): Promise<{ ledger: number }> {
    const deadline = Date.now() + this.cfg.submitTimeoutMs;
    await this.sleep(FIRST_POLL_DELAY_MS); // can't confirm before the next ledger close (~5s)
    let resp = await this.withTimeout('getTransaction', this.server.getTransaction(hash));
    while (resp.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      if (Date.now() >= deadline) {
        throw new RelayerTransferError('unavailable', 'transfer confirmation timed out');
      }
      await this.sleep(POLL_INTERVAL_MS);
      resp = await this.withTimeout('getTransaction', this.server.getTransaction(hash));
    }
    if (resp.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      this.logger.warn(`relayer transfer did not succeed [status=${resp.status}]`);
      throw new RelayerTransferError('transfer_failed');
    }
    return { ledger: resp.ledger };
  }

  /**
   * Lock-protected critical section: fetch the sequence, build + simulate + sign + submit the
   * `deploy_wallet` invocation, and return its hash. Must NOT include the poll. Throws
   * `SequenceError` on a txBAD_SEQ send rejection (the caller retries); a duplicate-deploy revert is
   * left to the caller's on-chain existence re-check (not parsed here).
   */
  private async buildAndSubmit(
    input: DeployPasskeyWalletInput,
    salt: Buffer,
  ): Promise<string> {
    const source = this.relayer.publicKey();
    const account = await this.withTimeout('getAccount', this.server.getAccount(source));

    // key_data = 65-byte uncompressed secp256r1 point ‖ raw credential id (smart-account-kit layout).
    const keyData = buildKeyData(input.secp256r1PublicKey, input.credentialId);
    const signer = xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol('External'),
      Address.fromString(this.cfg.webauthnVerifierAddress).toScVal(),
      xdr.ScVal.scvBytes(keyData),
    ]);

    const op = new Contract(this.cfg.factoryAddress).call(
      'deploy_wallet',
      xdr.ScVal.scvBytes(Buffer.from(this.cfg.walletWasmHash, 'hex')), // wasm_hash: BytesN<32>
      xdr.ScVal.scvBytes(salt), // salt: BytesN<32>
      xdr.ScVal.scvVec([signer]), // signers: Vec<Signer>
      xdr.ScVal.scvMap([]), // policies: empty Map (MVP single-key)
    );

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.cfg.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    // Simulation happens here; a duplicate deterministic deploy reverts with a host error, which the
    // outer catch resolves via an on-chain existence re-check (it does not parse this error).
    const prepared = await this.withTimeout('prepareTransaction', this.server.prepareTransaction(tx));
    prepared.sign(this.relayer);

    const sent = await this.withTimeout('sendTransaction', this.server.sendTransaction(prepared));
    switch (sent.status) {
      case 'PENDING':
      case 'DUPLICATE': // identical tx already submitted — poll its (same) hash
        return sent.hash;
      case 'TRY_AGAIN_LATER': // RPC throttle — retryable at the outer loop
        this.logger.warn('relayer sendTransaction throttled [status=TRY_AGAIN_LATER]');
        throw new ThrottledError();
      default: // 'ERROR'
        this.logger.warn(`relayer sendTransaction rejected the deploy [status=${sent.status}]`);
        if (this.isSequenceError(sent.errorResult)) throw new SequenceError();
        throw new Error('relayer sendTransaction rejected the deploy');
    }
  }

  /** Poll getTransaction until SUCCESS, bounded by the wall-clock deadline. */
  private async pollForResult(hash: string): Promise<xdr.ScVal> {
    const deadline = Date.now() + this.cfg.deployTimeoutMs;
    let resp = await this.withTimeout('getTransaction', this.server.getTransaction(hash));
    while (resp.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      if (Date.now() >= deadline) {
        throw new Error('relayer deploy timed out waiting for confirmation');
      }
      await this.sleep(POLL_INTERVAL_MS);
      resp = await this.withTimeout('getTransaction', this.server.getTransaction(hash));
    }
    if (resp.status !== rpc.Api.GetTransactionStatus.SUCCESS || !resp.returnValue) {
      this.logger.warn(`relayer deploy transaction did not succeed [status=${resp.status}]`);
      if (this.isSequenceError((resp as { resultXdr?: unknown }).resultXdr)) throw new SequenceError();
      throw new Error('relayer deploy transaction failed');
    }
    return resp.returnValue;
  }

  /** Whether a contract instance already has code at `contractId`. Errors -> treat as absent. */
  private async walletExists(contractId: string): Promise<boolean> {
    try {
      const key = xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: Address.fromString(contractId).toScAddress(),
          key: xdr.ScVal.scvLedgerKeyContractInstance(),
          durability: xdr.ContractDataDurability.persistent(),
        }),
      );
      const res = await this.withTimeout('getLedgerEntries', this.server.getLedgerEntries(key));
      return res.entries.length > 0;
    } catch (err) {
      // Can't determine -> proceed to deploy; the submit-time self-heal covers a real collision.
      this.logger.warn(`wallet existence check failed, proceeding to deploy: ${String(err)}`);
      return false;
    }
  }

  /**
   * Whether a failed transaction result is a stale-sequence collision (txBAD_SEQ). Reads the
   * `TransactionResultCode` enum (a stable XDR discriminant, unlike host-error text) defensively —
   * anything unexpected (a base64 string, a shape change) is treated as "not a sequence error".
   * Both call sites pass an `xdr.TransactionResult` (`sendTransaction().errorResult` and
   * `getTransaction().resultXdr`), so `.result()` is the correct accessor for each.
   */
  private isSequenceError(result: unknown): boolean {
    try {
      const txResult = result as { result?: () => { switch: () => { name?: string } } };
      return txResult?.result?.().switch().name === TX_BAD_SEQ;
    } catch {
      return false;
    }
  }

  /**
   * Bound a single relayer RPC call so one hung call can't exceed the lock TTL / poll deadline.
   * The losing promise's late rejection is swallowed to avoid an unhandledRejection when the
   * timeout wins (there is no AbortController on the SDK call, so the request itself isn't cancelled).
   */
  private withTimeout<T>(label: string, work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`relayer RPC timed out after ${RPC_TIMEOUT_MS}ms: ${label}`)),
        RPC_TIMEOUT_MS,
      );
    });
    work.catch(() => undefined);
    return Promise.race([work, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
