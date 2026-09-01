import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import {
  rpc,
  Account,
  Address,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  scValToBigInt,
} from '@stellar/stellar-sdk';
import { fractionReadConfig } from '@config/fraction-read.config';
import { withRpcTimeout } from '@common/soroban/with-rpc-timeout';
import { IFractionReadService } from './fraction-read.service.interface';
import { FractionReadUnavailableError } from './fraction-read.errors';
import { runBounded } from './run-bounded';

/**
 * On-chain FractionToken balance reader (TOV-237). Mirrors the proven relayer `readWalletHoldings` read
 * (simulate-only `token.balance(wallet)` + `scValToBigInt`) but with two deliberate differences suited to
 * a public read path: (1) a **synthetic source account** (`seq 0`, built PER CALL so concurrent
 * `TransactionBuilder.build()`s never race on a shared sequence) instead of a live `getAccount`; and (2)
 * **bounded** parallelism instead of unbounded `Promise.all`, to stay off the RPC 429 cliff. Simulation
 * doesn't consume a sequence, so concurrent reads from one key are safe. Any single failed read throws so
 * the caller can fail the whole request (a partial holdings list would mis-gate a Sell).
 */
@Injectable()
export class SorobanFractionReadService implements IFractionReadService {
  private readonly logger = new Logger(SorobanFractionReadService.name);
  private readonly server: rpc.Server;

  constructor(
    @Inject(fractionReadConfig.KEY) private readonly cfg: ConfigType<typeof fractionReadConfig>,
  ) {
    this.server = new rpc.Server(cfg.rpcUrl, { allowHttp: cfg.rpcUrl.startsWith('http://') });
  }

  async balancesOf(
    tokenContracts: string[],
    wallet: string,
    opts?: { timeoutMs?: number },
  ): Promise<Map<string, string>> {
    if (tokenContracts.length === 0) return new Map();
    const walletScVal = Address.fromString(wallet).toScVal();
    // A caller-supplied deadline caps BOTH the per-read timeout and the overall budget, so an abandoned
    // socket is released at that instant instead of lingering to the config's larger bounds (TOV-175 #374).
    const perReadMs = opts?.timeoutMs ?? this.cfg.timeoutMs;
    const budgetMs = opts?.timeoutMs ?? this.cfg.totalBudgetMs;
    const pairs = await this.withOverallBudget(
      runBounded(tokenContracts, this.cfg.concurrency, (token) => this.readOne(token, walletScVal, perReadMs)),
      budgetMs,
    );
    return new Map(pairs);
  }

  /**
   * Cap the whole fan-out at `budgetMs` (todo 249). The abandoned fan-out is pre-`.catch`ed so a later
   * worker rejection can't surface as an unhandledRejection once the budget has already thrown. Breaching
   * the budget is an operational read failure → `FractionReadUnavailableError` → 503 (complete-or-nothing).
   */
  private withOverallBudget<T>(work: Promise<T>, budgetMs: number): Promise<T> {
    work.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new FractionReadUnavailableError('balance reads exceeded time budget')),
        budgetMs,
      );
    });
    return Promise.race([work, budget]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  private async readOne(
    tokenContract: string,
    walletScVal: ReturnType<Address['toScVal']>,
    timeoutMs: number,
  ): Promise<[string, string]> {
    const op = new Contract(tokenContract).call('balance', walletScVal);
    let sim: Awaited<ReturnType<rpc.Server['simulateTransaction']>>;
    try {
      // Read-only balance doesn't consume a sequence — simulate against a fresh synthetic source (seq 0)
      // per call. A shared Account would be mutated by concurrent build()s (sequence race).
      const source = new Account(this.cfg.sourcePublicKey, '0');
      const tx = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase: this.cfg.networkPassphrase,
      })
        .addOperation(op)
        .setTimeout(30)
        .build();
      sim = await this.withTimeout(`balance:${tokenContract}`, this.server.simulateTransaction(tx), timeoutMs);
    } catch (err) {
      // Detail stays server-side; the thrown message never reaches the HTTP body.
      this.logger.warn(`fraction balance read failed [token=${tokenContract}]: ${String(err)}`);
      throw new FractionReadUnavailableError('balance read unavailable');
    }
    // isSimulationSuccess is the read-succeeded discriminator: a successful `0` is a genuine zero balance;
    // a failure / absent retval is a READ failure — never coerce it to 0.
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) {
      this.logger.warn(`fraction balance simulation failed [token=${tokenContract}]`);
      throw new FractionReadUnavailableError('balance simulation unavailable');
    }
    // `restorePreamble` (archived, state-expired entry): the value still reads correctly — log, don't fail.
    // Use the SDK's own type guard rather than a hand-rolled cast so a field rename breaks the build.
    if (rpc.Api.isSimulationRestore(sim)) {
      this.logger.warn(`fraction balance entry archived [token=${tokenContract}]`);
    }
    return [tokenContract, scValToBigInt(sim.result.retval).toString()];
  }

  private withTimeout<T>(label: string, promise: Promise<T>, timeoutMs: number): Promise<T> {
    return withRpcTimeout('fraction read', label, promise, timeoutMs);
  }
}
