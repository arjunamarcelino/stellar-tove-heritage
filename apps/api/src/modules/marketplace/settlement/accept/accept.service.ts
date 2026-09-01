import { createHash } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@common/enums/error-code.enum';
import { failHttp } from '@common/http/fail-http';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { IdempotencyStore } from '@common/idempotency/idempotency-store';
import { webauthnConfig } from '@config/webauthn.config';
import { marketplaceSettlementConfig } from '@config/marketplace-settlement.config';
import { WalletsService } from '@modules/wallets/wallets.service';
import { EmbeddedWalletNotFoundError } from '@modules/wallets/embedded-wallet-not-found.error';
import { decodeCoseToRawP256 } from '@modules/wallets/cose.helper';
import { USER_REPOSITORY, IUserRepository } from '@modules/users/repositories/user-repository.interface';
import {
  FRACTION_CONTRACT_REPOSITORY,
  IFractionContractRepository,
} from '@modules/fractionalization/repositories/fraction-contract-repository.interface';
import { RFQ_REPOSITORY, IRfqRepository } from '@modules/marketplace/rfqs/repositories/rfq-repository.interface';
import { QUOTE_REPOSITORY, IQuoteRepository } from '@modules/marketplace/quotes/repositories/quote-repository.interface';
import type { Quote } from '@modules/marketplace/quotes/entities/quote.entity';
import { RELAYER_SERVICE, IRelayerService } from '@modules/relayer/relayer.service.interface';
import { RelayerTransferError } from '@modules/relayer/relayer.errors';
import { computeUsdcSplit } from '@modules/relayer/accept-quote-invocation';
import {
  SECONDARY_TRADE_REPOSITORY,
  ISecondaryTradeRepository,
} from '../repositories/secondary-trade-repository.interface';
import { QUOTE_SETTLE_QUEUE, QUOTE_SETTLE_JOB, QuoteSettleJob } from '../settle/quote-settle.job';
import { AcceptDto, AcceptPrepareDto } from './dto/accept.dto';
import { AcceptPrepareResponseDto, AcceptResponseDto, TradeResponseDto } from './dto/accept-response.dto';

/** Resolved server-trusted context for a buyer accept. */
interface AcceptContext {
  quote: Quote;
  buyerWallet: string;
  sellerWallet: string;
  rfqId32: Buffer;
  quoteId32: Buffer;
  artworkId32: Buffer;
  count: string;
  gross: string;
}

/**
 * Buyer-accept + atomic-settlement surface (TOV-177, FR-06.04+06.05). `prepare` builds the buyer's own
 * `accept_quote` auth entry + challenge (the signed seller entry stays server-side); `accept` records a
 * `pending` trade (the double-accept latch) under a per-RFQ advisory lock and enqueues the async settle worker;
 * `getMe` is the poll target. The settle itself is the worker's job.
 */
@Injectable()
export class AcceptService {
  private readonly logger = new Logger(AcceptService.name);

  constructor(
    @Inject(QUOTE_REPOSITORY) private readonly quotes: IQuoteRepository,
    @Inject(RFQ_REPOSITORY) private readonly rfqs: IRfqRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(FRACTION_CONTRACT_REPOSITORY) private readonly contracts: IFractionContractRepository,
    @Inject(SECONDARY_TRADE_REPOSITORY) private readonly trades: ISecondaryTradeRepository,
    @Inject(RELAYER_SERVICE) private readonly relayer: IRelayerService,
    private readonly walletsService: WalletsService,
    private readonly idempotency: IdempotencyStore,
    @Inject(webauthnConfig.KEY) private readonly webauthn: ConfigType<typeof webauthnConfig>,
    @Inject(marketplaceSettlementConfig.KEY) private readonly cfg: ConfigType<typeof marketplaceSettlementConfig>,
    @InjectQueue(QUOTE_SETTLE_QUEUE) private readonly settleQueue: Queue,
  ) {}

  async prepare(userId: string, rfqId: string, dto: AcceptPrepareDto): Promise<AcceptPrepareResponseDto> {
    const resolution = await this.resolveWallet(userId);
    const ctx = await this.resolveContext(userId, rfqId, dto.quoteId, resolution.contractAddress);
    await this.assertSufficientUsdc(ctx.buyerWallet, BigInt(ctx.gross));

    const built = await this.relayer
      .buildAcceptQuote({
        settlerContract: this.cfg.settlerAddress,
        usdcContract: this.cfg.usdcAddress,
        buyerWallet: ctx.buyerWallet,
        sellerWallet: ctx.sellerWallet,
        rfqId: ctx.rfqId32,
        quoteId: ctx.quoteId32,
        artworkId: ctx.artworkId32,
        count: ctx.count,
        gross: ctx.gross,
        sigValidityLedgers: this.cfg.acceptSigValidityLedgers,
      })
      .catch((err: unknown) => {
        throw this.mapRelayerError(err, true);
      });

    const { platformCut, artistCut, sellerNet } = computeUsdcSplit(BigInt(ctx.gross));
    return {
      buyerAuthEntryXdr: built.buyerAuthEntryXdr,
      challenge: built.challenge,
      expiresAtLedger: built.expiresAtLedger,
      credentialId: resolution.credential.credentialId,
      transports: resolution.credential.transports,
      rpId: this.webauthn.rpId,
      trade: {
        count: ctx.count,
        grossStroops: ctx.gross,
        sellerNetStroops: sellerNet.toString(),
        platformFeeStroops: platformCut.toString(),
        artistRoyaltyStroops: artistCut.toString(),
      },
    };
  }

  async accept(userId: string, rfqId: string, dto: AcceptDto, idempotencyKey: string): Promise<AcceptResponseDto> {
    const key = `idem:trade:${userId}:${rfqId}:${idempotencyKey}`;
    const fingerprint = createHash('sha256').update(`${userId}|${rfqId}|${dto.quoteId}|${dto.buyerAuthEntryXdr}`).digest('hex');
    const begin = await this.idempotency.begin(key, fingerprint);
    if (begin.outcome === 'replay') return begin.body as AcceptResponseDto;
    if (begin.outcome === 'in_flight') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT, HttpStatus.CONFLICT, 'An accept with this key is still processing');
    }
    if (begin.outcome === 'mismatch') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_MISMATCH, HttpStatus.UNPROCESSABLE_ENTITY, 'Idempotency-Key reused with a different body');
    }
    const { token } = begin;
    const idemHash = createHash('sha256').update(`${userId}|${rfqId}|${idempotencyKey}`).digest();

    let stored: AcceptResponseDto;
    let job: QuoteSettleJob | null = null;
    try {
      const resolution = await this.resolveWallet(userId);
      const ctx = await this.resolveContext(userId, rfqId, dto.quoteId, resolution.contractAddress);
      await this.relayer.assertAcceptQuoteNotExpired(dto.buyerAuthEntryXdr).catch((err: unknown) => {
        if (err instanceof RelayerTransferError && err.reason === 'expired') {
          throw failHttp(ErrorCode.ACCEPT_CHALLENGE_EXPIRED, HttpStatus.UNPROCESSABLE_ENTITY, 'Signature expired — re-prepare the accept');
        }
        throw this.mapRelayerError(err, false);
      });
      const boundPublicKey = decodeCoseToRawP256(Uint8Array.from(resolution.credential.publicKey));

      const trade = await this.trades.runInTransaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [rfqId]);
        if (await this.trades.findPendingByRfq(rfqId, manager)) {
          throw failHttp(ErrorCode.TRADE_ALREADY_IN_FLIGHT, HttpStatus.CONFLICT, 'A settlement is already in progress for this RFQ');
        }
        const row = await this.trades.insertPending(manager, {
          rfqId,
          quoteId: ctx.quote.id,
          buyerSub: userId,
          sellerSub: ctx.quote.holderSub,
          fractionContractId: ctx.quote.fractionContractId,
          fractionCount: ctx.count,
          pricePerFractionStroops: ctx.quote.pricePerFractionStroops,
          idempotencyKeyHash: idemHash,
        });
        return row; // null → durable idem replay outside the txn
      });

      if (trade) {
        // findAcceptable already filtered `seller_auth_entry IS NOT NULL`, but guard explicitly rather than cast
        // away the `Buffer | null` — a null here would otherwise 500 mid-enqueue (#391).
        const sellerEntry = ctx.quote.sellerAuthEntry;
        if (!sellerEntry) {
          throw failHttp(ErrorCode.ACCEPT_QUOTE_NOT_ACCEPTABLE, HttpStatus.UNPROCESSABLE_ENTITY, 'This quote can no longer be accepted');
        }
        job = {
          tradeId: trade.id,
          rfqId,
          quoteId: ctx.quote.id,
          settlerContract: this.cfg.settlerAddress,
          usdcContract: this.cfg.usdcAddress,
          buyerWallet: ctx.buyerWallet,
          sellerWallet: ctx.sellerWallet,
          rfqId32: Buffer.from(ctx.rfqId32).toString('base64url'),
          quoteId32: Buffer.from(ctx.quoteId32).toString('base64url'),
          artworkId32: Buffer.from(ctx.artworkId32).toString('base64url'),
          count: ctx.count,
          gross: ctx.gross,
          buyerAuthEntryXdr: dto.buyerAuthEntryXdr,
          storedSellerEntryXdr: sellerEntry.toString('base64'),
          boundPublicKey: Buffer.from(boundPublicKey).toString('base64url'),
          credentialId: resolution.credential.credentialId,
          authenticatorData: dto.authenticatorData,
          clientDataJSON: dto.clientDataJSON,
          signature: dto.signature,
          rpId: this.webauthn.rpId,
          allowedOrigins: this.webauthn.origins,
        };
        stored = { tradeId: trade.id, status: 'pending' };
      } else {
        const existing = await this.trades.findByIdempotency(userId, rfqId, idemHash);
        if (!existing) {
          throw failHttp(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT, HttpStatus.CONFLICT, 'An accept with this key is still processing');
        }
        stored = { tradeId: existing.id, status: 'pending' };
      }
    } catch (err) {
      await this.idempotency.fail(key, token);
      throw err;
    }

    // Committed — best-effort complete + enqueue OUTSIDE the fail-guard (a post-commit blip must not revert a
    // recorded pending trade). If this enqueue is lost (or the job later exhausts its retries), the settle
    // reconcile backstop (#382) resolves the stranded pending trade — adopting it if the tx landed, else
    // abandoning it past the retry horizon so the per-RFQ latch is freed. It cannot re-drive the settle itself:
    // the buyer assertion below is job-only bearer material, never persisted.
    await this.idempotency.complete(key, token, stored);
    if (job) {
      try {
        await this.settleQueue.add(QUOTE_SETTLE_JOB, job, {
          jobId: `settle:${job.tradeId}:${randomUUID()}`,
          attempts: 8,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: { age: 900 },
        });
      } catch (err) {
        this.logger.error(`failed to enqueue settle job for trade ${job.tradeId}: ${String(err)}`);
      }
    }
    return stored;
  }

  async getMe(userId: string, rfqId: string): Promise<TradeResponseDto> {
    const trade = await this.trades.findLatestForBuyerRfq(userId, rfqId);
    if (!trade) throw failHttp(ErrorCode.TRADE_NOT_FOUND, HttpStatus.NOT_FOUND, 'No trade found for this RFQ');
    return TradeResponseDto.fromEntity(trade);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async resolveContext(userId: string, rfqId: string, quoteId: string, buyerWallet: string): Promise<AcceptContext> {
    const rfq = await this.rfqs.findOneById(rfqId);
    if (!rfq || rfq.collectorSub !== userId) {
      throw failHttp(ErrorCode.ACCEPT_NOT_RFQ_BUYER, HttpStatus.FORBIDDEN, 'Only the RFQ creator can accept a quote');
    }
    if (rfq.status !== 'open') {
      throw failHttp(ErrorCode.ACCEPT_RFQ_NOT_OPEN, HttpStatus.UNPROCESSABLE_ENTITY, 'This RFQ is no longer open');
    }
    const acceptable = await this.quotes.findAcceptable(rfqId, quoteId);
    if (!acceptable) {
      // Distinguish "not authorized yet" from other not-acceptable states for the FE.
      const quote = await this.quotes.findOneById(quoteId);
      if (quote && quote.rfqId === rfqId && quote.status === 'open' && !quote.sellerAuthEntry) {
        throw failHttp(ErrorCode.ACCEPT_QUOTE_NOT_AUTHORIZED, HttpStatus.UNPROCESSABLE_ENTITY, 'The seller has not authorized this quote');
      }
      throw failHttp(ErrorCode.ACCEPT_QUOTE_NOT_ACCEPTABLE, HttpStatus.UNPROCESSABLE_ENTITY, 'This quote can no longer be accepted');
    }
    await this.assertWhitelisted(userId);
    await this.assertWhitelisted(acceptable.holderSub);
    // buyerWallet is resolved ONCE by the caller and threaded in (avoids a duplicate lookup per request, #392).
    if (!acceptable.sellerWalletContract) {
      throw failHttp(ErrorCode.ACCEPT_QUOTE_NOT_ACCEPTABLE, HttpStatus.UNPROCESSABLE_ENTITY, 'This quote can no longer be accepted');
    }
    // The fraction contract must still be deployed with a bound token (the settler orchestrates the fraction
    // leg internally, so the accept flow needs the check, not the token address itself).
    const contract = await this.contracts.findOneById(acceptable.fractionContractId);
    if (!contract || contract.status !== 'deployed' || !contract.tokenAddress) {
      throw failHttp(ErrorCode.ACCEPT_QUOTE_NOT_ACCEPTABLE, HttpStatus.UNPROCESSABLE_ENTITY, 'This quote can no longer be accepted');
    }
    return {
      quote: acceptable,
      buyerWallet,
      sellerWallet: acceptable.sellerWalletContract,
      rfqId32: this.key32(rfqId),
      quoteId32: this.key32(quoteId),
      artworkId32: this.key32(rfq.artworkId),
      count: acceptable.fractionCount,
      gross: (BigInt(acceptable.fractionCount) * BigInt(acceptable.pricePerFractionStroops)).toString(),
    };
  }

  private async assertWhitelisted(userId: string): Promise<void> {
    const user = await this.users.findKycStatusByUserId(userId);
    if (!user || user.kycStatus !== KycStatus.WHITELISTED) {
      throw failHttp(ErrorCode.ACCEPT_NOT_WHITELISTED, HttpStatus.FORBIDDEN, 'Both parties must be whitelisted');
    }
  }

  private async resolveWallet(userId: string) {
    try {
      return await this.walletsService.resolveEmbeddedWalletForUser(userId);
    } catch (err) {
      if (err instanceof EmbeddedWalletNotFoundError) {
        throw failHttp(ErrorCode.ACCEPT_NOT_RFQ_BUYER, HttpStatus.FORBIDDEN, 'Set up your wallet to accept a quote');
      }
      throw err;
    }
  }

  private async assertSufficientUsdc(buyerWallet: string, gross: bigint): Promise<void> {
    let available: bigint;
    try {
      const holdings = await this.relayer.readWalletHoldings({ walletContract: buyerWallet, tokenContracts: [this.cfg.usdcAddress] });
      available = BigInt(holdings.find((h) => h.tokenContract === this.cfg.usdcAddress)?.amountScaled ?? '0');
    } catch {
      throw failHttp(ErrorCode.ACCEPT_SETTLEMENT_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE, 'USDC balance is temporarily unavailable');
    }
    if (available < gross) {
      throw new HttpException(
        {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          error: 'Unprocessable Entity',
          message: 'Insufficient USDC balance for this trade',
          errorCode: ErrorCode.ACCEPT_INSUFFICIENT_USDC,
          requiredStroops: gross.toString(),
          availableStroops: available.toString(),
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private key32(uuid: string): Buffer {
    return createHash('sha256').update(uuid, 'utf8').digest();
  }

  private mapRelayerError(err: unknown, atPrepare: boolean): HttpException {
    if (err instanceof HttpException) return err;
    if (err instanceof RelayerTransferError) {
      if (err.reason === 'unavailable' || err.reason === 'simulation_failed') {
        return failHttp(ErrorCode.ACCEPT_SETTLEMENT_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE, 'Settlement is temporarily unavailable');
      }
    }
    return atPrepare
      ? failHttp(ErrorCode.ACCEPT_SETTLEMENT_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE, 'Settlement is temporarily unavailable')
      : failHttp(ErrorCode.ACCEPT_CHALLENGE_EXPIRED, HttpStatus.UNPROCESSABLE_ENTITY, 'Could not submit the accept');
  }
}
