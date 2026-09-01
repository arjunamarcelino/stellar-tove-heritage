import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { relayerConfig } from '@config/relayer.config';
import { withRpcTimeout } from '@common/soroban/with-rpc-timeout';
import { WalletsService } from '@modules/wallets/wallets.service';
import { EmbeddedWalletNotFoundError } from '@modules/wallets/embedded-wallet-not-found.error';
import { RELAYER_SERVICE, IRelayerService } from '@modules/relayer/relayer.service.interface';
import { RelayerTransferError } from '@modules/relayer/relayer.errors';
import { BalanceWarningDto } from './dto/rfq-response.dto';
import { BALANCE_WARN_DEADLINE_MS } from './constants/rfq.constant';

/**
 * Soft-warn USDC balance advisor for RFQ creation (TOV-172). Isolated from `RfqsService` so the three
 * collaborators it needs (embedded-wallet resolution, the relayer balance read, the USDC token config)
 * don't leak into every service test, and the swallow-all semantics live in one focused, testable place.
 *
 * `warnIfInsufficient` NEVER throws and NEVER blocks: any failure — the collector has no embedded wallet,
 * the Soroban RPC errors, or the read exceeds the deadline — yields `undefined` (no warning) and the RFQ is
 * still created. When the read succeeds and the caller's USDC is below `required`, it returns the shortfall.
 * The warning reflects the EMBEDDED passkey wallet only and does not subtract funds already committed
 * elsewhere — it is advisory, not a solvency guarantee.
 */
@Injectable()
export class RfqBalanceAdvisor {
  private readonly logger = new Logger(RfqBalanceAdvisor.name);

  constructor(
    private readonly walletsService: WalletsService,
    @Inject(RELAYER_SERVICE) private readonly relayer: IRelayerService,
    @Inject(relayerConfig.KEY) private readonly relayerCfg: ConfigType<typeof relayerConfig>,
  ) {}

  async warnIfInsufficient(userId: string, required: bigint): Promise<BalanceWarningDto | undefined> {
    try {
      const resolution = await this.walletsService.resolveEmbeddedWalletForUser(userId);
      const holdings = await withRpcTimeout(
        'rfq balance',
        'readWalletHoldings',
        this.relayer.readWalletHoldings({
          walletContract: resolution.contractAddress,
          tokenContracts: [this.relayerCfg.usdcTokenAddress],
        }),
        BALANCE_WARN_DEADLINE_MS,
      );
      const available = holdings[0]?.amountScaled ?? '0';
      if (BigInt(available) < required) {
        return { requiredStroops: required.toString(), availableStroops: available };
      }
      return undefined;
    } catch (err) {
      // Soft-warn: a missing wallet, an RPC failure, or a timeout must never block RFQ creation. But
      // distinguish EXPECTED soft failures (no wallet / relayer-unavailable / deadline) — logged at debug —
      // from an UNEXPECTED error (misconfig, a TypeError, a wrong usdcTokenAddress) — logged at warn, so a
      // systemic failure that silently disables the balance warning is observable in production.
      if (this.isExpectedSoftFailure(err)) {
        this.logger.debug(`rfq balance soft-warn skipped for ${userId}: ${String(err)}`);
      } else {
        this.logger.warn(`rfq balance soft-warn unexpectedly failed for ${userId}: ${String(err)}`);
      }
      return undefined;
    }
  }

  /** Expected soft failures: no embedded wallet, a relayer/RPC failure, or the read exceeding the deadline. */
  private isExpectedSoftFailure(err: unknown): boolean {
    return (
      err instanceof EmbeddedWalletNotFoundError ||
      err instanceof RelayerTransferError ||
      (err instanceof Error && err.message.includes('timed out'))
    );
  }
}
