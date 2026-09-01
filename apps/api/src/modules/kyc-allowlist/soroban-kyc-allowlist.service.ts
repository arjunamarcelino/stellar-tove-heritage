import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { rpc, Account, Keypair, Contract, TransactionBuilder, BASE_FEE } from '@stellar/stellar-sdk';
import { kycAllowlistConfig } from '@config/kyc-allowlist.config';
import { withRpcTimeout } from '@common/soroban/with-rpc-timeout';
import {
  RELAYER_ACCOUNT_LOCK,
  IRelayerAccountLock,
} from '@modules/relayer/relayer-account-lock.interface';
import {
  IKycAllowlistTxService,
  KycAllowlistSubmitResult,
} from './kyc-allowlist-tx.service.interface';
import { KycAllowlistAction } from './kyc-allowlist.types';
import { walletToScVal } from './kyc-allowlist-encoding';
import { KycAllowlistThrottledError } from './kyc-allowlist.errors';
import {
  KYC_ALLOWLIST_RELAYER_LOCK_KEY,
  LOCK_TTL_BUFFER_MS,
  POLL_INTERVAL_MS,
  RPC_TIMEOUT_MS,
} from './kyc-allowlist.constants';

/**
 * On-chain KYCAllowlist adapter (TOV-235, TOV-141). Serializes each `add`/`remove` on the admin account
 * lock (the admin key is also the tx source, so it has its own sequence). Because the admin IS the source,
 * `admin.require_auth()` is satisfied by the source-account (envelope) signature — no separate
 * `authorizeEntry`. Polls to closure INSIDE the lock so the next item's `getAccount` observes the advanced
 * sequence (one tx / source account / ledger on Soroban). Reads (`is_allowed`) are sequence-free.
 */
@Injectable()
export class SorobanKycAllowlistService
  implements IKycAllowlistTxService, OnApplicationBootstrap
{
  private readonly logger = new Logger(SorobanKycAllowlistService.name);
  private readonly server: rpc.Server;
  private readonly admin: Keypair;

  constructor(
    @Inject(kycAllowlistConfig.KEY) private readonly cfg: ConfigType<typeof kycAllowlistConfig>,
    @Inject(RELAYER_ACCOUNT_LOCK) private readonly lock: IRelayerAccountLock,
  ) {
    this.server = new rpc.Server(cfg.rpcUrl, { allowHttp: cfg.rpcUrl.startsWith('http://') });
    this.admin = Keypair.fromSecret(cfg.adminSecret);
  }

  /**
   * Fail-fast boot probe (config-gated): the admin/source account must exist + be funded on-chain,
   * otherwise every submission fails at getAccount. Crash-loops on a missing account. The fail-fast blast
   * radius (a transient RPC blip at boot takes the whole backend down) is intentional for a signing service
   * — disable with `KYC_ALLOWLIST_BOOT_PROBE=false` in environments that boot offline / without testnet
   * reachability (todo 236).
   */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.cfg.probeOnBoot) return;
    try {
      await this.withTimeout('probe.getAccount', this.server.getAccount(this.admin.publicKey()));
    } catch (err) {
      throw new Error(
        `kyc allowlist boot probe: admin account ${this.admin.publicKey()} not found/funded on ` +
          `${this.cfg.rpcUrl}: ${String(err)}`,
      );
    }
    this.logger.log(`kyc allowlist boot probe OK (admin ${this.admin.publicKey()})`);
  }

  async isAllowed(wallet: string): Promise<boolean> {
    const op = new Contract(this.cfg.contractAddress).call('is_allowed', walletToScVal(wallet));
    let sim: Awaited<ReturnType<rpc.Server['simulateTransaction']>>;
    try {
      // Read-only `is_allowed` doesn't consume a sequence, so simulate against a synthetic source account
      // (seq 0) instead of a live getAccount — halves read-phase RPC calls / 429 exposure (todo 233).
      const source = new Account(this.admin.publicKey(), '0');
      const tx = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase: this.cfg.networkPassphrase,
      })
        .addOperation(op)
        .setTimeout(30)
        .build();
      sim = await this.withTimeout('simulate.isAllowed', this.server.simulateTransaction(tx));
    } catch (err) {
      // RPC failure is operational, not a business answer — surface as retryable.
      throw new KycAllowlistThrottledError(`is_allowed read unavailable: ${String(err)}`);
    }
    if (rpc.Api.isSimulationError(sim) || !sim.result) {
      throw new KycAllowlistThrottledError('is_allowed simulation unavailable');
    }
    const scv = sim.result.retval;
    if (scv.switch().name !== 'scvBool') {
      throw new Error('kyc allowlist is_allowed did not return a bool');
    }
    return scv.b();
  }

  submitOne(action: KycAllowlistAction, wallet: string): Promise<KycAllowlistSubmitResult> {
    // The whole critical section (getAccount → build → simulate → sign → send → poll-to-closure) runs under
    // the lock, so a concurrent batch can't build the same sequence and collide with txBadSeq. The TTL is
    // derived from submitTimeoutMs so it always exceeds the worst-case in-lock hold (todo 227).
    const lockTtl = this.cfg.submitTimeoutMs + LOCK_TTL_BUFFER_MS;
    return this.lock.withLock(KYC_ALLOWLIST_RELAYER_LOCK_KEY, lockTtl, () =>
      this.buildSignSendPoll(action, wallet),
    );
  }

  private async buildSignSendPoll(
    action: KycAllowlistAction,
    wallet: string,
  ): Promise<KycAllowlistSubmitResult> {
    const account = await this.withTimeout('getAccount', this.server.getAccount(this.admin.publicKey()));
    const op = new Contract(this.cfg.contractAddress).call(action, walletToScVal(wallet));
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.cfg.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const sim = await this.withTimeout('simulate.submit', this.server.simulateTransaction(tx));
    if (rpc.Api.isSimulationError(sim)) {
      throw new Error(`kyc allowlist ${action} simulation failed: ${sim.error}`);
    }

    // admin == source ⇒ require_auth(admin) is covered by the envelope signature; no authorizeEntry needed.
    const prepared = rpc.assembleTransaction(tx, sim).build();
    prepared.sign(this.admin);

    const sent = await this.withTimeout('sendTransaction', this.server.sendTransaction(prepared));
    switch (sent.status) {
      case 'PENDING':
      case 'DUPLICATE':
        break;
      case 'TRY_AGAIN_LATER':
        throw new KycAllowlistThrottledError('sendTransaction throttled');
      default:
        throw new Error(`kyc allowlist sendTransaction rejected [status=${sent.status}]`);
    }

    // Lowercase the hash before it leaves the adapter: the DB CHECK is `^[0-9a-f]{64}$`, and both the
    // event insert and the mirror upsert run in one txn — a non-lowercase hash would roll back the whole
    // batch after the on-chain mutation already committed (todo 230).
    const txHash = sent.hash.toLowerCase();
    const closed = await this.pollToClosure(sent.hash);
    if (closed.timedOut) return { status: 'pending', txHash };
    return { status: 'confirmed', txHash, ledger: closed.ledger };
  }

  /** Poll until the tx is included in a ledger (SUCCESS) or the per-item timeout fires (still NOT_FOUND). */
  private async pollToClosure(
    hash: string,
  ): Promise<{ timedOut: true } | { timedOut: false; ledger: number }> {
    const deadline = Date.now() + this.cfg.submitTimeoutMs;
    let resp = await this.withTimeout('getTransaction', this.server.getTransaction(hash));
    while (resp.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      if (Date.now() >= deadline) return { timedOut: true };
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      resp = await this.withTimeout('getTransaction', this.server.getTransaction(hash));
    }
    if (resp.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      // Included but reverted at apply time — the sequence advanced, so the batch can safely continue.
      throw new Error(`kyc allowlist ${hash} did not succeed [status=${resp.status}]`);
    }
    return { timedOut: false, ledger: resp.ledger };
  }

  private withTimeout<T>(label: string, promise: Promise<T>): Promise<T> {
    return withRpcTimeout('kyc allowlist', label, promise, RPC_TIMEOUT_MS);
  }
}
