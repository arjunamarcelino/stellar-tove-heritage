import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { RELAYER_SERVICE, IRelayerService } from '@modules/relayer/relayer.service.interface';
import {
  SECONDARY_TRADE_REPOSITORY,
  ISecondaryTradeRepository,
} from '../repositories/secondary-trade-repository.interface';
import {
  MARKETPLACE_SETTLER_READ_SERVICE,
  IMarketplaceSettlerReadService,
} from '../marketplace-settler-read.service.interface';
import type { SecondaryTrade } from '../entities/secondary-trade.entity';
import { QUOTE_SETTLE_QUEUE, QuoteSettleJob } from './quote-settle.job';
import { classifySettleFailure, SettleClassification } from './settle-failure.classifier';
import { SettlePersistenceService } from './settle-persistence.service';

const u8 = (b64url: string): Uint8Array => new Uint8Array(Buffer.from(b64url, 'base64url'));

/**
 * Async settle worker (TOV-177). Self-heal-FIRST via `is_settled` (the atomic accept_quote is on-chain
 * idempotent per `(rfq_id, quote_id)`), then relay the two-signature tx and reconcile the DB transactionally
 * (via {@link SettlePersistenceService}, shared with the reconcile processor). `concurrency:1` serializes on the
 * shared relayer send-lock. Money-safety: every terminal decision is gated on a fresh `is_settled==false` read
 * (a read failure re-throws RETRYABLE, never a spurious terminal-fail); the classifier is fail-closed.
 */
@Processor(QUOTE_SETTLE_QUEUE, { concurrency: 1, lockDuration: 180_000, stalledInterval: 30_000, maxStalledCount: 1 })
export class QuoteSettleProcessor extends WorkerHost {
  private readonly logger = new Logger(QuoteSettleProcessor.name);

  constructor(
    @Inject(SECONDARY_TRADE_REPOSITORY) private readonly trades: ISecondaryTradeRepository,
    @Inject(RELAYER_SERVICE) private readonly relayer: IRelayerService,
    @Inject(MARKETPLACE_SETTLER_READ_SERVICE) private readonly settlerRead: IMarketplaceSettlerReadService,
    private readonly persistence: SettlePersistenceService,
  ) {
    super();
  }

  async process(job: Job<QuoteSettleJob>): Promise<void> {
    const d = job.data;
    const trade = await this.trades.findOneById(d.tradeId);
    if (!trade || trade.status !== 'pending') return; // crash-replay-safe no-op

    // Self-heal: on a re-driven attempt the tx may already have landed (one-shot per rfq/quote). Skip the read
    // on attempt 0 — nothing has been submitted yet for this pair (saves an RPC).
    if (job.attemptsMade > 0 && (await this.settlerRead.isSettled(d.rfqId, d.quoteId))) {
      await this.persistence.persistSettled(trade, null);
      return;
    }

    // Best-effort buyer-USDC pre-check (#383): a buyer who drained their USDC below `gross` would revert the
    // accept_quote on the BUYER leg — a cross-contract (USDC-SAC) revert the classifier cannot reliably tell
    // apart from a seller-fault code, so it must not reach the classifier and wrongly expire the seller's quote.
    // Catch it here as a distinct buyer-fault (keepOpen). FAIL-OPEN: a read error proceeds to submit (the
    // enforcing re-simulation + on-chain revert stay the backstop), never blocking a genuinely-fundable settle.
    try {
      const holdings = await this.relayer.readWalletHoldings({
        walletContract: d.buyerWallet,
        tokenContracts: [d.usdcContract],
      });
      const usdc = holdings.find((h) => h.tokenContract === d.usdcContract);
      if (usdc && BigInt(usdc.amountScaled) < BigInt(d.gross)) {
        await this.terminalFail(trade, { terminal: true, reason: 'buyer_usdc_insufficient', quoteDisposition: 'keepOpen' });
      }
    } catch (err) {
      if (err instanceof UnrecoverableError) throw err; // the terminal-fail above — propagate
      // buyer-USDC read unavailable → proceed; the enforcing re-sim / on-chain revert is the money-safety backstop.
    }

    const outcome = await this.relayer.submitSignedAcceptQuote({
      settlerContract: d.settlerContract,
      usdcContract: d.usdcContract,
      buyerWallet: d.buyerWallet,
      sellerWallet: d.sellerWallet,
      rfqId: u8(d.rfqId32),
      quoteId: u8(d.quoteId32),
      artworkId: u8(d.artworkId32),
      count: d.count,
      gross: d.gross,
      buyerAuthEntryXdr: d.buyerAuthEntryXdr,
      storedSellerEntryXdr: d.storedSellerEntryXdr,
      boundPublicKey: u8(d.boundPublicKey),
      credentialId: d.credentialId,
      authenticatorData: u8(d.authenticatorData),
      clientDataJSON: u8(d.clientDataJSON),
      signature: u8(d.signature),
      rpId: d.rpId,
      allowedOrigins: d.allowedOrigins,
    });

    if (outcome.status === 'SUCCESS') {
      await this.persistence.persistSettled(trade, outcome.txHash);
      return;
    }

    // Non-success: the master money-safety gate is a FRESH is_settled read (throws → RETRYABLE, never coerced).
    if (await this.settlerRead.isSettled(d.rfqId, d.quoteId)) {
      await this.persistence.persistSettled(trade, null); // adopt — funds moved
      return;
    }
    const cls = classifySettleFailure(outcome);
    if (!cls.terminal) {
      throw new Error(`settle retry for trade ${d.tradeId} [${outcome.status}]`); // BullMQ backoff
    }
    await this.terminalFail(trade, cls);
  }

  /** Persist a terminal failure then stop retrying (the trade is `failed`, the pending latch is freed). */
  private async terminalFail(
    trade: SecondaryTrade,
    cls: Extract<SettleClassification, { terminal: true }>,
  ): Promise<never> {
    await this.persistence.failTrade(trade, cls);
    throw new UnrecoverableError(`trade ${trade.id} failed: ${cls.reason}`);
  }
}
