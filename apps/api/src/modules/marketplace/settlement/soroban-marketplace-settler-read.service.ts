import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { rpc, Keypair, Contract, Account, TransactionBuilder, BASE_FEE, xdr, scValToNative } from '@stellar/stellar-sdk';
import { marketplaceSettlementConfig } from '@config/marketplace-settlement.config';
import { relayerConfig } from '@config/relayer.config';
import { withRpcTimeout } from '@common/soroban/with-rpc-timeout';
import {
  IMarketplaceSettlerReadService,
  MarketplaceSettlerReadUnavailableError,
} from './marketplace-settler-read.service.interface';

/**
 * Simulate-only `MarketplaceSettler.is_settled(rfq_id, quote_id)` reader (TOV-177) — the settle worker's
 * self-heal oracle. Mirrors `SorobanFractionReadService`: a synthetic source `Account(sourcePublicKey, '0')`
 * (a read consumes no sequence and the account need not exist), no lock, no signing. Throws
 * `MarketplaceSettlerReadUnavailableError` on ANY failure — never coerces an unavailable read to `false`.
 * The `BytesN<32>` args are `sha256(uuid)` — the same salt convention as `TokenInit.artwork_id` (TOV-233).
 */
@Injectable()
export class SorobanMarketplaceSettlerReadService implements IMarketplaceSettlerReadService {
  private readonly logger = new Logger(SorobanMarketplaceSettlerReadService.name);
  private readonly server: rpc.Server;
  private readonly sourcePublicKey: string;

  constructor(
    @Inject(marketplaceSettlementConfig.KEY)
    private readonly cfg: ConfigType<typeof marketplaceSettlementConfig>,
    @Inject(relayerConfig.KEY)
    relayer: ConfigType<typeof relayerConfig>,
  ) {
    this.server = new rpc.Server(this.cfg.rpcUrl, { allowHttp: this.cfg.rpcUrl.startsWith('http://') });
    // Synthetic read source derived from the relayer seed (no secret retained). Fail fast if misconfigured.
    this.sourcePublicKey = Keypair.fromSecret(relayer.relayerSecret).publicKey();
  }

  async isSettled(rfqId: string, quoteId: string): Promise<boolean> {
    try {
      const op = new Contract(this.cfg.settlerAddress).call('is_settled', this.key(rfqId), this.key(quoteId));
      const tx = new TransactionBuilder(new Account(this.sourcePublicKey, '0'), {
        fee: BASE_FEE,
        networkPassphrase: this.cfg.networkPassphrase,
      })
        .addOperation(op)
        .setTimeout(30)
        .build();
      const sim = await withRpcTimeout(
        'marketplace-settler',
        `is_settled:${rfqId}`,
        this.server.simulateTransaction(tx),
        this.cfg.readTimeoutMs,
      );
      if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) {
        this.logger.warn('marketplace settler is_settled simulation failed');
        throw new MarketplaceSettlerReadUnavailableError();
      }
      return scValToNative(sim.result.retval) === true;
    } catch (err) {
      if (err instanceof MarketplaceSettlerReadUnavailableError) throw err;
      throw new MarketplaceSettlerReadUnavailableError(err instanceof Error ? err.message : undefined);
    }
  }

  /** sha256(uuid) → BytesN<32> ScVal (matches TokenInit.artwork_id / the accept_quote tuple ids). */
  private key(uuid: string): xdr.ScVal {
    return xdr.ScVal.scvBytes(createHash('sha256').update(uuid, 'utf8').digest());
  }
}
