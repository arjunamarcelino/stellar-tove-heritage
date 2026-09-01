import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import {
  rpc,
  Keypair,
  Contract,
  Address,
  TransactionBuilder,
  xdr,
  authorizeEntry,
  BASE_FEE,
  Operation,
} from '@stellar/stellar-sdk';
import { fractionFactoryConfig } from '@config/fraction-factory.config';
import { withRpcTimeout } from '@common/soroban/with-rpc-timeout';
import {
  RELAYER_ACCOUNT_LOCK,
  IRelayerAccountLock,
} from '@modules/relayer/relayer-account-lock.interface';
import { deriveWalletAddress } from '@modules/relayer/wallet-address';
import {
  DeployFractionTokenInput,
  DeployFractionTokenResult,
  IFractionFactoryService,
} from './fraction-factory.service.interface';
import { deriveArtworkSalt, encodeTokenInitScVal } from './token-init';
import { FRACTION_RELAYER_LOCK_KEY } from './fraction.constants';

/** Retryable throttle from the RPC (TRY_AGAIN_LATER). BullMQ retries the job. */
export class FractionThrottledError extends Error {}
/** txBAD_SEQ on the shared relayer account — the caller re-fetches the sequence and retries. */
export class FractionSequenceError extends Error {}

const RPC_TIMEOUT_MS = 5_000;
const LOCK_TTL_MS = 20_000;
const POLL_INTERVAL_MS = 1_000;
/** Auth-entry validity window (~8-9 min at 5s/ledger) — short bound limits replay of a leaked entry. */
const AUTH_VALID_LEDGERS = 100;

/**
 * On-chain FractionTokenFactory adapter (TOV-233). Mirrors the passkey relayer's deploy flow
 * (simulate → sign → send → poll, timeout-bounded, serialized behind a Redis lock), with two
 * differences the contract mandates: `deploy` is admin-gated (a separate `FRACTION_FACTORY_ADMIN_SECRET`
 * signs the `SorobanAuthorizationEntry`; the relayer keypair is only the tx source), and duplicates are a
 * typed `ArtworkAlreadyDeployed` error — so `tokenOf` (the registry read) is the self-heal oracle.
 *
 * The exact TokenInit ScVal encoding + deterministic-address derivation are validated by the gated
 * live-testnet test (todos/102) + a golden-vector unit test — not by CI's fake-backed suites.
 */
@Injectable()
export class SorobanFractionFactoryService
  implements IFractionFactoryService, OnApplicationBootstrap
{
  private readonly logger = new Logger(SorobanFractionFactoryService.name);
  private readonly server: rpc.Server;
  private readonly relayer: Keypair;
  private readonly admin: Keypair;

  constructor(
    @Inject(fractionFactoryConfig.KEY)
    private readonly cfg: ConfigType<typeof fractionFactoryConfig>,
    @Inject(RELAYER_ACCOUNT_LOCK) private readonly lock: IRelayerAccountLock,
  ) {
    this.server = new rpc.Server(cfg.rpcUrl, { allowHttp: cfg.rpcUrl.startsWith('http://') });
    this.relayer = Keypair.fromSecret(cfg.relayerSecret);
    this.admin = Keypair.fromSecret(cfg.factoryAdminSecret);
  }

  /**
   * Fail-fast boot probe (config-gated by `FRACTION_BOOT_PROBE`, default on; disable in tests/offline
   * dev). Asserts (1) the relayer source account exists on-chain — every deploy/self-heal read needs it —
   * and (2) the on-chain `factory.admin()` equals our configured admin key, otherwise every admin-gated
   * deploy would fail `admin.require_auth()` after burning fees. Crash-loops on mismatch.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.cfg.probeOnBoot) return;
    try {
      await this.withTimeout('probe.getAccount', this.server.getAccount(this.relayer.publicKey()));
    } catch (err) {
      throw new Error(
        `fraction boot probe: relayer account ${this.relayer.publicKey()} not found/funded on ` +
          `${this.cfg.rpcUrl}: ${String(err)}`,
      );
    }
    const onChainAdmin = await this.readFactoryAdmin();
    if (onChainAdmin !== this.admin.publicKey()) {
      throw new Error(
        `fraction boot probe: on-chain factory.admin()=${onChainAdmin} != configured admin ` +
          `${this.admin.publicKey()} — deploys would fail admin.require_auth(). Fix FRACTION_FACTORY_ADMIN_SECRET.`,
      );
    }
    this.logger.log(`fraction boot probe OK (factory admin ${onChainAdmin})`);
  }

  /** Read the factory's `admin()` view (simulate-only) → G-address. */
  private async readFactoryAdmin(): Promise<string> {
    const op = new Contract(this.cfg.factoryAddress).call('admin');
    const source = await this.withTimeout('probe.getAccount', this.server.getAccount(this.relayer.publicKey()));
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.cfg.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();
    const sim = await this.withTimeout('probe.simulate.admin', this.server.simulateTransaction(tx));
    if (rpc.Api.isSimulationError(sim) || !sim.result) {
      throw new Error(`fraction boot probe: factory.admin() simulation failed`);
    }
    const scv = sim.result.retval;
    if (scv.switch().name !== 'scvAddress') {
      throw new Error('fraction boot probe: factory.admin() did not return an address');
    }
    return Address.fromScAddress(scv.address()).toString();
  }

  async tokenOf(artworkId: string): Promise<string | null> {
    const salt = deriveArtworkSalt(artworkId);
    const op = new Contract(this.cfg.factoryAddress).call('token_of', xdr.ScVal.scvBytes(salt));
    let sim: Awaited<ReturnType<rpc.Server['simulateTransaction']>>;
    try {
      // getAccount THROWS if the relayer account is unfunded / doesn't exist; that (and any RPC
      // timeout) is operational, NOT a business failure — surface it as a RETRYABLE throttle so the
      // deploy worker re-queues instead of misclassifying it as terminal and reverting the artwork.
      const source = await this.withTimeout('getAccount', this.server.getAccount(this.relayer.publicKey()));
      const tx = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase: this.cfg.networkPassphrase,
      })
        .addOperation(op)
        .setTimeout(30)
        .build();
      sim = await this.withTimeout('simulate.tokenOf', this.server.simulateTransaction(tx));
    } catch (err) {
      throw new FractionThrottledError(`token_of read unavailable: ${String(err)}`);
    }
    if (rpc.Api.isSimulationError(sim) || !sim.result) {
      throw new FractionThrottledError('token_of simulation unavailable');
    }
    const scv = sim.result.retval;
    // Option<Address>: Void → None (genuinely not deployed).
    if (scv.switch().name === 'scvVoid') return null;
    if (scv.switch().name !== 'scvAddress') return null;
    return Address.fromScAddress(scv.address()).toString();
  }

  async deployFractionToken(input: DeployFractionTokenInput): Promise<DeployFractionTokenResult> {
    const salt = deriveArtworkSalt(input.artworkId);
    // Off-chain deterministic address = fn(factory, salt); the on-chain existence check is authoritative.
    const derived = deriveWalletAddress(this.cfg.factoryAddress, salt, this.cfg.networkPassphrase);

    // Self-heal: the factory is NOT idempotent (duplicate → ArtworkAlreadyDeployed), so read the
    // registry first. A hit means the token already exists (crash-window recovery / job retry).
    const existing = await this.tokenOf(input.artworkId);
    if (existing) {
      if (existing !== derived) {
        this.logger.warn(
          `token_of(${input.artworkId}) returned ${existing} but derived ${derived} — using registry value`,
        );
      }
      return { tokenAddress: existing, txHash: '', deployLedger: null };
    }

    // Hold the relayer-account lock ONLY through send (the sequence-consuming step); poll OUTSIDE the
    // lock so a slow deploy never starves other relayer users, and LOCK_TTL_MS need only cover the ~4
    // bounded RPCs of the critical section (not the deploy-timeout poll loop).
    const txHash = await this.lock.withLock(FRACTION_RELAYER_LOCK_KEY, LOCK_TTL_MS, () =>
      this.buildSignAndSend(input, salt),
    );
    const resp = await this.pollForResult(txHash);
    const tokenAddress =
      resp.returnValue && resp.returnValue.switch().name === 'scvAddress'
        ? Address.fromScAddress(resp.returnValue.address()).toString()
        : derived;
    return { tokenAddress, txHash, deployLedger: String(resp.ledger) };
  }

  /** Lock-protected critical section: simulate → admin-authorize → assemble → source-sign → send.
   * Returns the submitted tx hash; the caller polls OUTSIDE the lock. */
  private async buildSignAndSend(input: DeployFractionTokenInput, salt: Buffer): Promise<string> {
    const account = await this.withTimeout(
      'getAccount',
      this.server.getAccount(this.relayer.publicKey()),
    );
    const initVal = this.buildTokenInitScVal(input, salt);
    const op = new Contract(this.cfg.factoryAddress).call('deploy', initVal);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.cfg.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const sim = await this.withTimeout('simulate.deploy', this.server.simulateTransaction(tx));
    if (rpc.Api.isSimulationError(sim)) {
      // A duplicate deterministic deploy reverts here; the caller re-checks tokenOf.
      throw new Error(`fraction deploy simulation failed: ${sim.error}`);
    }

    // Admin-authorize: sign only the address-credential entries owned by the factory admin. Source-account
    // credentials are covered by the envelope signature below.
    const validUntil = (await this.withTimeout('getLatestLedger', this.server.getLatestLedger())).sequence
      + AUTH_VALID_LEDGERS;
    const rawAuth = sim.result?.auth ?? [];
    const results = await Promise.all(rawAuth.map((entry) => this.signAdminEntry(entry, validUntil)));
    const signedAuth = results.map((r) => r.entry);
    const adminSigned = results.filter((r) => r.signed).length;

    // `deploy` is admin-gated (`admin.require_auth()`). Unless the admin IS the tx source account (in which
    // case source-account credentials cover require_auth and no separate entry exists), at least one admin
    // address-credential entry must have been signed. If none was — empty sim auth, a renamed/missing admin
    // entry, or a wrong-admin config — we would otherwise broadcast an unauthorized, fee-spending,
    // guaranteed-to-revert tx. Fail closed before send instead.
    const adminIsSource = this.admin.publicKey() === this.relayer.publicKey();
    if (!adminIsSource && adminSigned === 0) {
      throw new Error(
        'fraction deploy: no admin authorization entry was signed — admin/config or contract-shape mismatch',
      );
    }

    const prepared = rpc.assembleTransaction(tx, sim).build();
    if (signedAuth.length > 0) {
      const invoke = prepared.operations[0] as Operation.InvokeHostFunction;
      invoke.auth = signedAuth;
    }
    prepared.sign(this.relayer);
    const txHash = prepared.hash().toString('hex');
    if (input.onTxHash) await input.onTxHash(txHash);

    const sent = await this.withTimeout('sendTransaction', this.server.sendTransaction(prepared));
    switch (sent.status) {
      case 'PENDING':
      case 'DUPLICATE':
        return sent.hash;
      case 'TRY_AGAIN_LATER':
        throw new FractionThrottledError('sendTransaction throttled');
      default:
        if (this.isSequenceError(sent.errorResult)) {
          throw new FractionSequenceError('txBadSeq on the fraction relayer account');
        }
        throw new Error(`fraction sendTransaction rejected [status=${sent.status}]`);
    }
  }

  /** Sign an auth entry iff it is an address-credential entry owned by the factory admin. */
  private async signAdminEntry(
    entry: xdr.SorobanAuthorizationEntry,
    validUntil: number,
  ): Promise<{ entry: xdr.SorobanAuthorizationEntry; signed: boolean }> {
    const creds = entry.credentials();
    // Source-account credentials are covered by the envelope signature — never signed here.
    if (creds.switch().name === 'sorobanCredentialsSourceAccount') return { entry, signed: false };
    const addr = Address.fromScAddress(creds.address().address()).toString();
    if (addr !== this.admin.publicKey()) return { entry, signed: false };
    const signed = await authorizeEntry(entry, this.admin, validUntil, this.cfg.networkPassphrase);
    return { entry: signed, signed: true };
  }

  /** Map cfg + per-artwork values into the 17 resolved fields and encode (pure `encodeTokenInitScVal`,
   * golden-vector-pinned). */
  private buildTokenInitScVal(input: DeployFractionTokenInput, salt: Buffer): xdr.ScVal {
    return encodeTokenInitScVal({
      artworkSalt: salt,
      name: input.init.name,
      symbol: input.init.symbol,
      proxyAdmin: this.cfg.tokenProxyAdmin,
      artist: input.init.artistAddress,
      artistPayout: input.init.artistAddress,
      treasury: this.cfg.treasuryAddress,
      artistRetention: BigInt(input.init.artistRetentionAmount),
      artistLockupUntil: BigInt(input.init.artistLockupUntil),
      treasuryRetention: BigInt(input.init.treasuryRetentionAmount),
      treasuryLockupUntil: BigInt(input.init.treasuryLockupUntil),
      kycAllowlist: this.cfg.kycAllowlistAddress,
      freezeSet: this.cfg.freezeSetAddress,
      marketplaceSettler: this.cfg.marketplaceSettlerAddress,
      minter: this.cfg.minterPlaceholderAddress,
      usdc: this.cfg.usdcTokenAddress,
      implWasmHash: Buffer.from(this.cfg.tokenWasmHash, 'hex'),
    });
  }

  private async pollForResult(hash: string): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
    const deadline = Date.now() + this.cfg.deployTimeoutMs;
    let resp = await this.withTimeout('getTransaction', this.server.getTransaction(hash));
    while (resp.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      if (Date.now() >= deadline) throw new FractionThrottledError('poll timeout');
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      resp = await this.withTimeout('getTransaction', this.server.getTransaction(hash));
    }
    if (resp.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error(`fraction deploy did not succeed [status=${resp.status}]`);
    }
    return resp;
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
    return withRpcTimeout('fraction', label, promise, RPC_TIMEOUT_MS);
  }
}

/** Exported for the golden-vector unit test: the off-chain deterministic token address. */
export function deriveFractionTokenAddress(
  factoryAddress: string,
  artworkId: string,
  networkPassphrase: string,
): string {
  return deriveWalletAddress(factoryAddress, deriveArtworkSalt(artworkId), networkPassphrase);
}
