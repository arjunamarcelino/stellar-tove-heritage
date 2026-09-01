import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import {
  rpc,
  Keypair,
  Address,
  Contract,
  TransactionBuilder,
  xdr,
  scValToNative,
  BASE_FEE,
  Operation,
} from '@stellar/stellar-sdk';
import { offeringEscrowConfig } from '@config/offering-escrow.config';
import { withRpcTimeout } from '@common/soroban/with-rpc-timeout';
import {
  RELAYER_ACCOUNT_LOCK,
  IRelayerAccountLock,
} from '@modules/relayer/relayer-account-lock.interface';
import {
  CloseAndSettleInput,
  CloseAndSettleResult,
  CloseOfferingInput,
  DeployEscrowInput,
  DeployEscrowResult,
  IOfferingEscrowService,
  OfferingEscrowStatus,
} from './offering-escrow.service.interface';
import { deriveOfferingEscrowAddress, escrowSalt } from './offering-escrow-address';
import { encodeConstructorArgs } from './offering-escrow-args';
import { encodeAllocations, encodeClearingPrice } from './settle-args';
import {
  OfferingEscrowError,
  OfferingEscrowSequenceError,
  OfferingEscrowThrottledError,
  OfferingEscrowWasmMismatchError,
  OfferingSettleContractError,
} from './offering-escrow.errors';
import { OFFERING_ESCROW_LOCK_KEY } from '../offering.constants';

const RPC_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 1_000;
/**
 * Awaited RPCs before the confirmation poll: getLedgerEntries (self-heal) → getAccount → simulate → send.
 * Used to size the Redis lock TTL from the REAL worst-case hold rather than a config knob (todo 285).
 */
const PRE_POLL_RPC_COUNT = 4;
/** Safety head-room on the lock TTL above the computed worst-case in-lock hold. */
const LOCK_TTL_MARGIN_MS = 15_000;

/** OfferingEscrow contract error discriminant (`error.rs`) — `OfferingNotOpen = 1` (close ran while not Open). */
const CONTRACT_ERR_OFFERING_NOT_OPEN = 1;

/** A signed, fee-assembled Soroban transaction ready to send (what `assembleTransaction(...).build()` returns). */
type PreparedTx = ReturnType<ReturnType<typeof rpc.assembleTransaction>['build']>;

/**
 * On-chain OfferingEscrow deploy adapter (TOV-154, D6/D7). Mirrors the fraction-factory / kyc-allowlist
 * Soroban flow: simulate → assemble → sign → send → poll, timeout-bounded, fully serialized behind the
 * shared escrow-account Redis lock. Two differences the design mandates:
 *  - **Direct deploy, no factory** — `Operation.createCustomContract` bakes the 8 constructor args in and
 *    the network computes the deterministic address from (admin source, `salt = sha256(offeringId)`).
 *  - **Admin-as-source** — ONE `OFFERING_ESCROW_ADMIN_SECRET` is BOTH the constructor `admin` arg AND the
 *    tx source, so the contract's `admin.require_auth()` is covered by the envelope signature — no
 *    `authorizeEntry`.
 *
 * The whole critical section (getAccount → build → simulate → sign → send → poll-to-closure) runs INSIDE
 * the lock (Enhancement #12, kyc-allowlist parity) so a multi-instance deployment can't build two deploys
 * on the shared source account in one ledger (txBadSeq churn). Self-heal reads the contract-instance
 * ledger entry first: a hit means the escrow already exists (crash-window recovery / BullMQ retry) — adopt
 * it only if its WASM hash matches (Enhancement #3), else hard-fail.
 */
@Injectable()
export class SorobanOfferingEscrowService
  implements IOfferingEscrowService, OnApplicationBootstrap
{
  private readonly logger = new Logger(SorobanOfferingEscrowService.name);
  private readonly server: rpc.Server;
  private readonly admin: Keypair;
  /**
   * One-shot boot-probe latch (#334). Both the deploy AND settle worker modules bind this class (each gets
   * its own instance, correct), so `onApplicationBootstrap` would otherwise probe the same admin account
   * twice at boot. Static so the first instance's probe suffices for both.
   */
  private static probed = false;

  constructor(
    @Inject(offeringEscrowConfig.KEY)
    private readonly cfg: ConfigType<typeof offeringEscrowConfig>,
    @Inject(RELAYER_ACCOUNT_LOCK) private readonly lock: IRelayerAccountLock,
  ) {
    this.server = new rpc.Server(cfg.rpcUrl, { allowHttp: cfg.rpcUrl.startsWith('http://') });
    this.admin = Keypair.fromSecret(cfg.adminSecret);
  }

  /**
   * Fail-fast boot probe (config-gated by `OFFERING_ESCROW_BOOT_PROBE`, default on; disable in
   * tests/offline dev). Asserts the escrow admin/source account exists + is funded on-chain — every
   * deploy/self-heal read needs it. Crash-loops on a missing account (a transient RPC blip taking the
   * backend down at boot is intentional for a signing service).
   */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.cfg.probeOnBoot || SorobanOfferingEscrowService.probed) return;
    SorobanOfferingEscrowService.probed = true;
    try {
      await this.withTimeout('probe.getAccount', this.server.getAccount(this.admin.publicKey()));
    } catch (err) {
      throw new Error(
        `offering escrow boot probe: admin account ${this.admin.publicKey()} not found/funded on ` +
          `${this.cfg.rpcUrl}: ${String(err)}`,
      );
    }
    this.logger.log(`offering escrow boot probe OK (deployer ${this.admin.publicKey()})`);
  }

  deployEscrow(input: DeployEscrowInput): Promise<DeployEscrowResult> {
    // Derive the lock TTL from the REAL worst-case hold (todo 285): the pre-poll RPCs, plus the poll
    // ceiling AND its ~1 overshoot iteration (deadline check → sleep POLL_INTERVAL_MS → one more getTransaction
    // up to RPC_TIMEOUT_MS), plus margin. The former `deployTimeoutMs + pollTimeoutMs + 5s` bounded no actual
    // call (RPCs use RPC_TIMEOUT_MS) and left ~0 margin, risking a mid-poll lock expiry → multi-instance txBadSeq.
    const lockTtl =
      PRE_POLL_RPC_COUNT * RPC_TIMEOUT_MS +
      this.cfg.pollTimeoutMs +
      POLL_INTERVAL_MS +
      RPC_TIMEOUT_MS +
      LOCK_TTL_MARGIN_MS;
    return this.lock.withLock(OFFERING_ESCROW_LOCK_KEY, lockTtl, () => this.deployLocked(input));
  }

  /** Lock-protected critical section (Enhancement #12): self-heal → build → simulate → sign → send → poll. */
  private async deployLocked(input: DeployEscrowInput): Promise<DeployEscrowResult> {
    const salt = escrowSalt(input.offeringId);
    const address = deriveOfferingEscrowAddress(
      this.admin.publicKey(),
      salt,
      this.cfg.networkPassphrase,
    );

    // Self-heal: the deploy is NOT idempotent (a duplicate createCustomContract reverts), so read the
    // on-chain contract-instance entry first. A hit means the escrow already exists (crash between
    // on-chain success and the DB latch, or a BullMQ retry). Adopt it ONLY if the WASM hash matches the
    // configured escrow hash (security HIGH-3); on mismatch never adopt — hard-fail.
    const onChainWasm = await this.readInstanceWasmHash(address);
    if (onChainWasm !== null) {
      if (onChainWasm !== this.cfg.wasmHash) {
        throw new OfferingEscrowWasmMismatchError(
          `escrow ${address} exists with wasmHash ${onChainWasm} != configured ${this.cfg.wasmHash}`,
        );
      }
      return { contractAddress: address, txHash: null };
    }

    const account = await this.withTimeout(
      'getAccount',
      this.server.getAccount(this.admin.publicKey()),
    );
    const op = Operation.createCustomContract({
      address: Address.fromString(this.admin.publicKey()),
      wasmHash: Buffer.from(this.cfg.wasmHash, 'hex'),
      salt,
      constructorArgs: encodeConstructorArgs(input.args),
    });
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.cfg.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const sim = await this.withTimeout('simulate.deploy', this.server.simulateTransaction(tx));
    if (rpc.Api.isSimulationError(sim)) {
      // A duplicate deterministic deploy reverts here; a fresh attempt re-reads the instance + self-heals.
      throw new OfferingEscrowError(`offering escrow deploy simulation failed: ${sim.error}`, false);
    }

    // admin == source ⇒ `admin.require_auth()` is covered by the envelope signature; no authorizeEntry.
    const prepared = rpc.assembleTransaction(tx, sim).build();
    // Fee ceiling (todo 287): assembleTransaction folds the simulation's resource+inclusion fee onto the tx.
    // Cap it before signing so a misbehaving/compromised RPC can't drain the shared funded admin account via
    // an inflated fee across retries (mirrors the relayer transfer's RELAYER_MAX_TX_FEE guard).
    if (BigInt(prepared.fee) > BigInt(this.cfg.maxTxFee)) {
      throw new OfferingEscrowError(
        `offering escrow deploy fee ${prepared.fee} exceeds cap ${this.cfg.maxTxFee}`,
        false,
      );
    }
    prepared.sign(this.admin);
    const txHash = prepared.hash().toString('hex');

    const sent = await this.withTimeout('sendTransaction', this.server.sendTransaction(prepared));
    switch (sent.status) {
      case 'PENDING':
      case 'DUPLICATE':
        break;
      case 'TRY_AGAIN_LATER':
        throw new OfferingEscrowThrottledError('sendTransaction throttled');
      default:
        if (this.isSequenceError(sent.errorResult)) {
          throw new OfferingEscrowSequenceError();
        }
        throw new OfferingEscrowError(
          `offering escrow sendTransaction rejected [status=${sent.status}]`,
          false,
        );
    }

    // Poll to closure INSIDE the lock so the next deploy on this source account observes the advanced
    // sequence (one tx / source / ledger on Soroban).
    await this.pollToClosure(sent.hash);
    return { contractAddress: address, txHash };
  }

  // ── TOV-160 settlement (close_offering + close_and_settle + readStatus) ─────────────────────────────

  /**
   * Read the escrow's on-chain lifecycle status (read-only simulate, NO lock — a getter consumes no
   * sequence). The authoritative self-heal oracle. An RPC/simulation failure surfaces as a retryable error
   * (a deployed escrow's `status()` should always read); an unrecognized variant → `'unknown'`.
   */
  async readStatus(escrowAddress: string): Promise<OfferingEscrowStatus> {
    const account = await this.withTimeout(
      'settle.getAccount',
      this.server.getAccount(this.admin.publicKey()),
    );
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.cfg.networkPassphrase,
    })
      .addOperation(new Contract(escrowAddress).call('status'))
      .setTimeout(30)
      .build();
    const sim = await this.withTimeout('settle.simulate.status', this.server.simulateTransaction(tx));
    if (rpc.Api.isSimulationError(sim)) {
      throw new OfferingEscrowThrottledError(`readStatus simulation failed: ${sim.error}`);
    }
    const retval = sim.result?.retval;
    if (!retval) {
      throw new OfferingEscrowThrottledError('readStatus returned no value');
    }
    return decodeEscrowStatus(retval);
  }

  async closeOffering(input: CloseOfferingInput): Promise<{ txHash: string | null }> {
    return this.lock.withLock(OFFERING_ESCROW_LOCK_KEY, this.settleLockTtl(), async () => {
      const op = new Contract(input.escrowAddress).call('close_offering');
      const { prepared } = await this.buildSimulateAssemble('close_offering', op, (err) => {
        // `OfferingNotOpen` (#1) is the ONE revert close_offering can hit, and it is NOT terminal: it means
        // the offering was already closed (a benign concurrent/duplicate settle job won the close first, or a
        // prior attempt landed). Classify it RETRYABLE so the losing job re-throws → BullMQ backoff → the next
        // attempt's self-heal-first `readStatus` observes `Closed`/`Settled` and adopts, instead of stamping a
        // spurious terminal `settle_failed` that would exclude the row from the stale-subscribed reconcile
        // and wedge auto-recovery (TOV-160 #317). Any OTHER revert is a genuine terminal fault.
        if (parseContractErrorCode(err) === CONTRACT_ERR_OFFERING_NOT_OPEN) {
          throw new OfferingEscrowThrottledError(`close_offering: already closed (${err})`);
        }
        throw new OfferingSettleContractError(
          `close_offering reverted: ${err}`,
          parseContractErrorCode(err),
        );
      });
      prepared.sign(this.admin);
      const txHash = prepared.hash().toString('hex');
      await this.sendAndPoll('close_offering', prepared);
      return { txHash };
    });
  }

  async closeAndSettle(input: CloseAndSettleInput): Promise<CloseAndSettleResult> {
    return this.lock.withLock(OFFERING_ESCROW_LOCK_KEY, this.settleLockTtl(), async () => {
      // Adopt (self-heal) if already Settled on-chain (crash-after-landing) — authoritative INSIDE the lock.
      const status = await this.readStatus(input.escrowAddress);
      if (status === 'settled') {
        return { txHash: null, ledger: null, alreadySettled: true };
      }
      const op = new Contract(input.escrowAddress).call(
        'close_and_settle',
        encodeClearingPrice(input.clearingPrice),
        encodeAllocations(input.allocations.map((a) => ({ bidId: a.bidId, allocated: a.allocated }))),
      );
      const { prepared } = await this.buildSimulateAssemble('close_and_settle', op, (err) => {
        // A revert at simulation (InvalidAllocation=8, TokenNotBound=13, resource exhaustion, …) is
        // DETERMINISTIC → terminal, else the worker would retry-loop forever on the same book.
        throw new OfferingSettleContractError(
          `close_and_settle reverted: ${err}`,
          parseContractErrorCode(err),
        );
      });
      prepared.sign(this.admin);
      const txHash = prepared.hash().toString('hex');
      const ledger = await this.sendAndPoll('close_and_settle', prepared);
      return { txHash, ledger, alreadySettled: false };
    });
  }

  /** Lock TTL for a settlement leg — same derivation as deploy (one build→simulate→send→poll cycle). */
  private settleLockTtl(): number {
    return (
      PRE_POLL_RPC_COUNT * RPC_TIMEOUT_MS +
      this.cfg.pollTimeoutMs +
      POLL_INTERVAL_MS +
      RPC_TIMEOUT_MS +
      LOCK_TTL_MARGIN_MS
    );
  }

  /** getAccount → build(op) → simulate (→ onSimError) → assemble → fee cap. Returns the prepared, unsigned tx. */
  private async buildSimulateAssemble(
    label: string,
    op: xdr.Operation,
    onSimError: (err: string) => never,
  ): Promise<{ prepared: PreparedTx }> {
    const account = await this.withTimeout(
      `settle.getAccount.${label}`,
      this.server.getAccount(this.admin.publicKey()),
    );
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.cfg.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();
    const sim = await this.withTimeout(`settle.simulate.${label}`, this.server.simulateTransaction(tx));
    if (rpc.Api.isSimulationError(sim)) {
      onSimError(sim.error);
    }
    // admin == source ⇒ require_auth covered by the envelope signature; no authorizeEntry. Belt: reject any
    // non-source-account auth entry (a malicious escrow demanding a second signer).
    const auth = sim.result?.auth ?? [];
    for (const entry of auth) {
      if (entry.credentials().switch().name !== 'sorobanCredentialsSourceAccount') {
        throw new OfferingEscrowError(
          `settle ${label}: unexpected non-source-account auth entry — refusing to sign`,
          false,
        );
      }
    }
    const prepared = rpc.assembleTransaction(tx, sim).build();
    if (BigInt(prepared.fee) > BigInt(this.cfg.maxTxFee)) {
      throw new OfferingEscrowError(
        `settle ${label} fee ${prepared.fee} exceeds cap ${this.cfg.maxTxFee}`,
        false,
      );
    }
    return { prepared };
  }

  /** send → classify (throttle/txBadSeq retryable) → poll to closure. Returns the settled ledger. */
  private async sendAndPoll(
    label: string,
    prepared: PreparedTx,
  ): Promise<number> {
    const sent = await this.withTimeout(`settle.send.${label}`, this.server.sendTransaction(prepared));
    switch (sent.status) {
      case 'PENDING':
      case 'DUPLICATE':
        break;
      case 'TRY_AGAIN_LATER':
        throw new OfferingEscrowThrottledError(`settle ${label} throttled`);
      default:
        if (this.isSequenceError(sent.errorResult)) {
          throw new OfferingEscrowSequenceError();
        }
        throw new OfferingEscrowThrottledError(
          `settle ${label} sendTransaction rejected [status=${sent.status}] — retry (self-heal re-reads status)`,
        );
    }
    return this.pollForLedger(label, sent.hash);
  }

  private async pollForLedger(label: string, hash: string): Promise<number> {
    const deadline = Date.now() + this.cfg.pollTimeoutMs;
    let resp = await this.withTimeout('settle.getTransaction', this.server.getTransaction(hash));
    while (resp.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      if (Date.now() >= deadline) {
        // Never confirmed — retryable; the retry re-reads on-chain status (adopt if it actually landed).
        throw new OfferingEscrowThrottledError(`settle ${label} poll timeout`);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      resp = await this.withTimeout('settle.getTransaction', this.server.getTransaction(hash));
    }
    if (resp.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      // FAILED = applied-but-reverted (sequence advanced). Retryable: the retry's readStatus adopts if the
      // settlement actually landed, else re-simulates (a genuine terminal revert surfaces at simulation).
      throw new OfferingEscrowThrottledError(`settle ${label} did not succeed [status=${resp.status}]`);
    }
    return resp.ledger;
  }

  /**
   * Read the contract-instance ledger entry at `address` and return its executable WASM hash (hex), or
   * `null` when no contract exists there yet. Uses `getLedgerEntries` (empty array on miss) rather than
   * `getContractData` (which throws a synthetic 404 that would mask genuine RPC errors). A non-WASM
   * executable arm (e.g. a Stellar-asset contract at the address) is surfaced as a mismatch.
   */
  private async readInstanceWasmHash(address: string): Promise<string | null> {
    const key = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: Address.fromString(address).toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    );
    const resp = await this.withTimeout(
      'getLedgerEntries.instance',
      this.server.getLedgerEntries(key),
    );
    const entry = resp.entries[0];
    if (!entry?.val) return null;
    const executable = entry.val.contractData().val().instance().executable();
    if (executable.switch().name !== 'contractExecutableWasm') {
      throw new OfferingEscrowWasmMismatchError(
        `contract at ${address} is not a WASM contract (arm=${executable.switch().name})`,
      );
    }
    return executable.wasmHash().toString('hex');
  }

  private async pollToClosure(hash: string): Promise<void> {
    const deadline = Date.now() + this.cfg.pollTimeoutMs;
    let resp = await this.withTimeout('getTransaction', this.server.getTransaction(hash));
    while (resp.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      if (Date.now() >= deadline) {
        // Never confirmed within the window — surface as retryable so BullMQ re-runs (the retry
        // re-derives + self-heals if the tx did eventually apply).
        throw new OfferingEscrowThrottledError('offering escrow deploy poll timeout');
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      resp = await this.withTimeout('getTransaction', this.server.getTransaction(hash));
    }
    if (resp.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new OfferingEscrowError(
        `offering escrow deploy did not succeed [status=${resp.status}]`,
        false,
      );
    }
  }

  // errorResult is the typed XDR union from sendTransaction; read the result-code arm by name. The
  // try/catch is belt-and-suspenders against an unexpected union arm — never a substitute for the type.
  private isSequenceError(errorResult?: xdr.TransactionResult): boolean {
    try {
      return errorResult?.result().switch().name === 'txBadSeq';
    } catch {
      return false;
    }
  }

  private withTimeout<T>(label: string, promise: Promise<T>): Promise<T> {
    return withRpcTimeout('offering escrow', label, promise, RPC_TIMEOUT_MS);
  }
}

/** Exported for the golden-vector unit test: the off-chain deterministic escrow address. */
export function deriveOfferingEscrowAddressFor(
  deployerPubKey: string,
  offeringId: string,
  networkPassphrase: string,
): string {
  return deriveOfferingEscrowAddress(deployerPubKey, escrowSalt(offeringId), networkPassphrase);
}

/**
 * Decode the escrow's `status()` return value (a unit-variant `#[contracttype] enum Status` serializes to an
 * ScVal Vec of one Symbol = the variant name). Unrecognized → `'unknown'`.
 */
export function decodeEscrowStatus(retval: xdr.ScVal): OfferingEscrowStatus {
  const native: unknown = scValToNative(retval);
  const variant: unknown = Array.isArray(native) ? (native as unknown[])[0] : native;
  switch (String(variant)) {
    case 'Open':
      return 'open';
    case 'Closed':
      return 'closed';
    case 'Settled':
      return 'settled';
    case 'Cancelled':
      return 'cancelled';
    default:
      return 'unknown';
  }
}

/**
 * Parse the `#<n>` CONTRACT error code out of a simulation error string, or `null` (a resource/host failure
 * or a non-contract revert). Matches ONLY the canonical `Error(Contract, #n)` shape — the loose `/#(\d+)/`
 * fallback was dropped (#336) because this now drives control flow (#317 classifies `OfferingNotOpen=1` as
 * retryable), so a stray `#5` in an unrelated budget/ledger line must never be mistaken for a contract code.
 */
export function parseContractErrorCode(simError: string): number | null {
  const m = /Error\(Contract,\s*#(\d+)\)/.exec(simError);
  return m ? Number(m[1]) : null;
}
