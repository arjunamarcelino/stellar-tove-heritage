import { createHash } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { ErrorCode } from '@common/enums/error-code.enum';
import { failHttp } from '@common/http/fail-http';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { IdempotencyStore } from '@common/idempotency/idempotency-store';
import { webauthnConfig } from '@config/webauthn.config';
import { marketplaceSettlementConfig } from '@config/marketplace-settlement.config';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { AUDIT_KIND } from '@modules/wallets/audit/audit-log.types';
import { WalletsService } from '@modules/wallets/wallets.service';
import { EmbeddedWalletNotFoundError } from '@modules/wallets/embedded-wallet-not-found.error';
import { decodeCoseToRawP256 } from '@modules/wallets/cose.helper';
import { USER_REPOSITORY, IUserRepository } from '@modules/users/repositories/user-repository.interface';
import {
  FRACTION_CONTRACT_REPOSITORY,
  IFractionContractRepository,
} from '@modules/fractionalization/repositories/fraction-contract-repository.interface';
import { FRACTION_READ_SERVICE, IFractionReadService } from '@modules/fractionalization/fraction-read.service.interface';
import { parseAmount } from '@modules/fractionalization/amount';
import { RFQ_REPOSITORY, IRfqRepository } from '@modules/marketplace/rfqs/repositories/rfq-repository.interface';
import { QUOTE_REPOSITORY, IQuoteRepository } from '@modules/marketplace/quotes/repositories/quote-repository.interface';
import type { Quote } from '@modules/marketplace/quotes/entities/quote.entity';
import { RELAYER_SERVICE, IRelayerService } from '@modules/relayer/relayer.service.interface';
import { RelayerTransferError } from '@modules/relayer/relayer.errors';
import { QUOTE_BALANCE_TIMEOUT_MS } from '@modules/marketplace/quotes/constants/quote.constant';
import { AuthorizeQuoteDto } from './dto/authorize.dto';
import { AuthorizePrepareResponseDto } from './dto/authorize-prepare-response.dto';
import { AuthorizeResponseDto } from './dto/authorize-response.dto';

const LEDGER_MS = 5000; // ~5s per ledger close on Soroban.

/** Resolved context for building/verifying the seller authorization on a quote. */
interface AuthContext {
  quote: Quote;
  sellerWallet: string;
  buyerWallet: string;
  tokenAddress: string;
  rfqId32: Buffer;
  quoteId32: Buffer;
  artworkId32: Buffer;
  count: string;
  gross: string;
}

/**
 * Seller-authorize surface (TOV-177, FR-06.04): a whitelisted holder pre-signs their open quote for atomic
 * settlement. The signed `accept_quote` auth entry is stored on the quote and replayed at accept. `prepare`
 * is a pure read/build (no DB write); `attach` stores under a per-`(seller, token)` advisory lock with an
 * authoritative over-authorization free-balance gate (mirrors the TOV-175 quote-submit scaffold).
 */
@Injectable()
export class AuthorizeService {
  constructor(
    @Inject(QUOTE_REPOSITORY) private readonly quotes: IQuoteRepository,
    @Inject(RFQ_REPOSITORY) private readonly rfqs: IRfqRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(FRACTION_CONTRACT_REPOSITORY) private readonly contracts: IFractionContractRepository,
    @Inject(FRACTION_READ_SERVICE) private readonly fractionRead: IFractionReadService,
    @Inject(RELAYER_SERVICE) private readonly relayer: IRelayerService,
    private readonly walletsService: WalletsService,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditLogService,
    @Inject(webauthnConfig.KEY) private readonly webauthn: ConfigType<typeof webauthnConfig>,
    @Inject(marketplaceSettlementConfig.KEY) private readonly cfg: ConfigType<typeof marketplaceSettlementConfig>,
  ) {}

  async prepare(userId: string, rfqId: string, quoteId: string): Promise<AuthorizePrepareResponseDto> {
    const resolution = await this.resolveSellerWallet(userId);
    const ctx = await this.resolveContext(userId, rfqId, quoteId, resolution.contractAddress);
    // Fast-fail: does the seller hold at least `count` on-chain at all? (The AUTHORITATIVE over-auth check —
    // onchain − Σ authorized — runs under the advisory lock at attach.)
    const onchain = await this.readBalance(ctx);
    if (onchain < BigInt(ctx.count)) throw this.overAuthorized(BigInt(ctx.count), onchain);

    const built = await this.relayer
      .buildSellerQuoteAuth({
        settlerContract: this.cfg.settlerAddress,
        usdcContract: this.cfg.usdcAddress,
        buyerWallet: ctx.buyerWallet,
        sellerWallet: ctx.sellerWallet,
        rfqId: ctx.rfqId32,
        quoteId: ctx.quoteId32,
        artworkId: ctx.artworkId32,
        count: ctx.count,
        gross: ctx.gross,
        sigValidityLedgers: this.sigValidityLedgers(ctx.quote.validUntil),
      })
      .catch((err: unknown) => {
        throw this.mapRelayerError(err);
      });

    return AuthorizePrepareResponseDto.build({
      challenge: built.challenge,
      expiresAtLedger: built.expiresAtLedger,
      credentialId: resolution.credential.credentialId,
      transports: resolution.credential.transports,
      rpId: this.webauthn.rpId,
      sellerAuthEntryXdr: built.sellerAuthEntryXdr,
      count: ctx.count,
      grossStroops: ctx.gross,
      pricePerFractionStroops: ctx.quote.pricePerFractionStroops,
    });
  }

  async authorize(
    userId: string,
    rfqId: string,
    quoteId: string,
    dto: AuthorizeQuoteDto,
    idempotencyKey: string,
  ): Promise<AuthorizeResponseDto> {
    const key = `idem:quote-authorize:${userId}:${quoteId}:${idempotencyKey}`;
    const fingerprint = createHash('sha256').update(`${userId}|${quoteId}|${dto.sellerAuthEntryXdr}`).digest('hex');
    const begin = await this.idempotency.begin(key, fingerprint);
    if (begin.outcome === 'replay') return begin.body as AuthorizeResponseDto;
    if (begin.outcome === 'in_flight') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT, HttpStatus.CONFLICT, 'An authorization with this key is still processing');
    }
    if (begin.outcome === 'mismatch') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_MISMATCH, HttpStatus.UNPROCESSABLE_ENTITY, 'Idempotency-Key reused with a different body');
    }
    const { token } = begin;

    let stored: AuthorizeResponseDto;
    try {
      const resolution = await this.resolveSellerWallet(userId);
      const ctx = await this.resolveContext(userId, rfqId, quoteId, resolution.contractAddress);
      const boundPublicKey = decodeCoseToRawP256(Uint8Array.from(resolution.credential.publicKey));

      const attached = await this.relayer
        .attachSellerQuoteAuth({
          settlerContract: this.cfg.settlerAddress,
          usdcContract: this.cfg.usdcAddress,
          buyerWallet: ctx.buyerWallet,
          sellerWallet: ctx.sellerWallet,
          rfqId: ctx.rfqId32,
          quoteId: ctx.quoteId32,
          artworkId: ctx.artworkId32,
          count: ctx.count,
          gross: ctx.gross,
          sellerAuthEntryXdr: dto.sellerAuthEntryXdr,
          boundPublicKey,
          credentialId: resolution.credential.credentialId,
          authenticatorData: new Uint8Array(Buffer.from(dto.authenticatorData, 'base64url')),
          clientDataJSON: new Uint8Array(Buffer.from(dto.clientDataJSON, 'base64url')),
          signature: new Uint8Array(Buffer.from(dto.signature, 'base64url')),
          rpId: this.webauthn.rpId,
          allowedOrigins: this.webauthn.origins,
        })
        .catch((err: unknown) => {
          throw this.mapRelayerError(err);
        });

      const onchain = await this.readBalance(ctx);
      const authorizedAt = await this.quotes.runInTransaction(async (manager) => {
        // Serialize this seller's authorizations on this token (over-auth free decision is authoritative here).
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [userId, ctx.quote.fractionContractId]);
        // Exclude the quote being (re-)authorized so its own prior commitment isn't counted against itself (#385).
        const locked = await this.quotes.sumAuthorizedLockedCount(manager, userId, ctx.quote.fractionContractId, {
          excludeQuoteId: quoteId,
        });
        const free = onchain - locked;
        if (free < BigInt(ctx.count)) throw this.overAuthorized(BigInt(ctx.count), free);
        const ok = await this.quotes.markAuthorized(manager, quoteId, {
          entry: Buffer.from(attached.signedEntryXdr, 'base64'),
          expiresLedger: attached.expiresAtLedger,
          wallet: ctx.sellerWallet,
        });
        if (!ok) {
          // Raced to a non-open status between the gate and the write.
          throw failHttp(ErrorCode.QUOTE_NOT_AUTHORIZABLE, HttpStatus.UNPROCESSABLE_ENTITY, 'This quote can no longer be authorized');
        }
        await this.audit.record(
          {
            actorType: 'user',
            actorId: userId,
            kind: AUDIT_KIND.QUOTE_AUTHORIZED,
            subjectType: 'rfq_quote',
            subjectId: quoteId,
            payload: { rfqId, authExpiresLedger: attached.expiresAtLedger },
          },
          manager,
        );
        return new Date();
      });
      stored = AuthorizeResponseDto.build(quoteId, authorizedAt, attached.expiresAtLedger);
    } catch (err) {
      await this.idempotency.fail(key, token);
      throw err;
    }
    await this.idempotency.complete(key, token, stored);
    return stored;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Load + gate the quote and resolve every server-trusted value for the accept_quote tuple. */
  private async resolveContext(userId: string, rfqId: string, quoteId: string, sellerWallet: string): Promise<AuthContext> {
    const quote = await this.quotes.findOneById(quoteId);
    // Same 404 for missing / not-owned / wrong-RFQ so a seller can't probe others' quote ids.
    if (!quote || quote.holderSub !== userId || quote.rfqId !== rfqId) {
      throw failHttp(ErrorCode.QUOTE_NOT_FOUND, HttpStatus.NOT_FOUND, 'Quote not found');
    }
    if (quote.status !== 'open' || quote.validUntil.getTime() <= Date.now()) {
      throw failHttp(ErrorCode.QUOTE_NOT_AUTHORIZABLE, HttpStatus.UNPROCESSABLE_ENTITY, 'This quote can no longer be authorized');
    }
    const user = await this.users.findKycStatusByUserId(userId);
    if (!user || user.kycStatus !== KycStatus.WHITELISTED) {
      throw failHttp(ErrorCode.QUOTE_NOT_WHITELISTED, HttpStatus.FORBIDDEN, 'Complete KYC to authorize a quote');
    }
    const rfq = await this.rfqs.findOneById(quote.rfqId);
    if (!rfq) throw failHttp(ErrorCode.QUOTE_NOT_FOUND, HttpStatus.NOT_FOUND, 'Quote not found');
    const buyerWallet = await this.resolveBuyerWallet(rfq.collectorSub);
    const contract = await this.contracts.findOneById(quote.fractionContractId);
    if (!contract || contract.status !== 'deployed' || !contract.tokenAddress) {
      throw failHttp(ErrorCode.QUOTE_NOT_AUTHORIZABLE, HttpStatus.UNPROCESSABLE_ENTITY, 'This quote can no longer be authorized');
    }
    // sellerWallet is resolved ONCE by the caller and threaded in (avoids a duplicate lookup per request, #392).
    return {
      quote,
      sellerWallet,
      buyerWallet,
      tokenAddress: contract.tokenAddress,
      rfqId32: this.key32(rfqId),
      quoteId32: this.key32(quoteId),
      artworkId32: this.key32(rfq.artworkId),
      count: quote.fractionCount,
      gross: (BigInt(quote.fractionCount) * BigInt(quote.pricePerFractionStroops)).toString(),
    };
  }

  private async resolveSellerWallet(userId: string) {
    try {
      return await this.walletsService.resolveEmbeddedWalletForUser(userId);
    } catch (err) {
      if (err instanceof EmbeddedWalletNotFoundError) {
        throw failHttp(ErrorCode.QUOTE_NO_SETTLEMENT_WALLET, HttpStatus.UNPROCESSABLE_ENTITY, 'Set up your wallet to authorize a quote');
      }
      throw err;
    }
  }

  private async resolveBuyerWallet(buyerSub: string): Promise<string> {
    try {
      return (await this.walletsService.resolveEmbeddedWalletForUser(buyerSub)).contractAddress;
    } catch (err) {
      if (err instanceof EmbeddedWalletNotFoundError) {
        // The RFQ buyer isn't settlement-ready — a seller can't authorize a trade that can never settle.
        throw failHttp(ErrorCode.QUOTE_NOT_AUTHORIZABLE, HttpStatus.UNPROCESSABLE_ENTITY, 'This RFQ cannot be settled yet');
      }
      throw err;
    }
  }

  private async readBalance(ctx: AuthContext): Promise<bigint> {
    try {
      const balances = await this.fractionRead.balancesOf([ctx.tokenAddress], ctx.sellerWallet, { timeoutMs: QUOTE_BALANCE_TIMEOUT_MS });
      return parseAmount(balances.get(ctx.tokenAddress), 'balance', { nonNegative: true });
    } catch {
      throw failHttp(ErrorCode.QUOTE_BALANCE_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE, 'Fraction balance is temporarily unavailable');
    }
  }

  private sigValidityLedgers(validUntil: Date): number {
    return Math.max(1, Math.floor((validUntil.getTime() - Date.now()) / LEDGER_MS));
  }

  private key32(uuid: string): Buffer {
    return createHash('sha256').update(uuid, 'utf8').digest();
  }

  private mapRelayerError(err: unknown): HttpException {
    if (err instanceof RelayerTransferError) {
      return failHttp(ErrorCode.QUOTE_AUTH_INVALID, HttpStatus.UNPROCESSABLE_ENTITY, 'Could not authorize this quote');
    }
    return err instanceof HttpException ? err : failHttp(ErrorCode.QUOTE_AUTH_INVALID, HttpStatus.UNPROCESSABLE_ENTITY, 'Could not authorize this quote');
  }

  private overAuthorized(required: bigint, free: bigint): HttpException {
    return new HttpException(
      {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: 'Authorizing this quote would exceed your free fraction balance',
        errorCode: ErrorCode.QUOTE_OVER_AUTHORIZED,
        requiredCount: required.toString(),
        freeBalance: (free < 0n ? 0n : free).toString(),
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
