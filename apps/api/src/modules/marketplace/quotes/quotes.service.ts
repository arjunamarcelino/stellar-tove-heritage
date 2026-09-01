import { createHash } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@common/enums/error-code.enum';
import { failHttp } from '@common/http/fail-http';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { IdempotencyStore } from '@common/idempotency/idempotency-store';
import { MAX_STROOPS, MAX_I128 } from '@common/constants/stroops.constant';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { AUDIT_KIND } from '@modules/wallets/audit/audit-log.types';
import { WalletsService } from '@modules/wallets/wallets.service';
import { EmbeddedWalletNotFoundError } from '@modules/wallets/embedded-wallet-not-found.error';
import {
  USER_REPOSITORY,
  IUserRepository,
} from '@modules/users/repositories/user-repository.interface';
import {
  FRACTION_CONTRACT_REPOSITORY,
  IFractionContractRepository,
} from '@modules/fractionalization/repositories/fraction-contract-repository.interface';
import {
  FRACTION_READ_SERVICE,
  IFractionReadService,
} from '@modules/fractionalization/fraction-read.service.interface';
import { parseAmount } from '@modules/fractionalization/amount';
import {
  RFQ_REPOSITORY,
  IRfqRepository,
} from '@modules/marketplace/rfqs/repositories/rfq-repository.interface';
import type { Rfq } from '@modules/marketplace/rfqs/entities/rfq.entity';
import { QUOTE_REPOSITORY, IQuoteRepository } from './repositories/quote-repository.interface';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { QuoteResponseDto } from './dto/quote-response.dto';
import { QUOTE_BALANCE_TIMEOUT_MS } from './constants/quote.constant';

/** True iff `err` is a Postgres CHECK violation (23514) on the named constraint (driverError-safe). */
function isCheckViolation(err: unknown, constraint: string): boolean {
  const e = err as { code?: string; constraint?: string; driverError?: { code?: string; constraint?: string } };
  return (e?.code ?? e?.driverError?.code) === '23514' && (e?.constraint ?? e?.driverError?.constraint) === constraint;
}

/**
 * Quote submission (TOV-175, FR-06.03): a whitelisted holder offers to SELL fractions on an open RFQ. Pure DB
 * write at submit, gated by a HARD, fail-closed on-chain free-balance check. Clones the TOV-172 RFQ-creation
 * idempotency/fail-guard scaffolding; borrows the offering-bids advisory-lock + hard-balance-gate pattern.
 */
@Injectable()
export class QuotesService {
  constructor(
    @Inject(QUOTE_REPOSITORY) private readonly quotes: IQuoteRepository,
    @Inject(RFQ_REPOSITORY) private readonly rfqs: IRfqRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(FRACTION_CONTRACT_REPOSITORY) private readonly contracts: IFractionContractRepository,
    @Inject(FRACTION_READ_SERVICE) private readonly fractionRead: IFractionReadService,
    private readonly walletsService: WalletsService,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditLogService,
  ) {}

  async submit(
    userId: string,
    rfqId: string,
    dto: CreateQuoteDto,
    idempotencyKey: string,
  ): Promise<QuoteResponseDto> {
    const key = `idem:quote:${userId}:${rfqId}:${idempotencyKey}`;
    // Canonicalize the instant (toISOString) so a re-serialized-equivalent retry replays, not a false 422.
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          rfqId,
          pricePerFractionStroops: dto.pricePerFractionStroops,
          fractionCount: dto.fractionCount,
          validUntil: new Date(dto.validUntil).toISOString(),
        }),
      )
      .digest('hex');

    const begin = await this.idempotency.begin(key, fingerprint);
    if (begin.outcome === 'replay') {
      // Sound cast: the stored snapshot is the exact prior `complete()` body for this key, round-tripped as
      // opaque JSON — do not "harden" this into a re-fetch (the snapshot is the source of truth for replay).
      return begin.body as QuoteResponseDto;
    }
    if (begin.outcome === 'in_flight') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT, HttpStatus.CONFLICT, 'A quote with this key is still processing');
    }
    if (begin.outcome === 'mismatch') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_MISMATCH, HttpStatus.UNPROCESSABLE_ENTITY, 'Idempotency-Key reused with a different body');
    }
    const { token } = begin;

    // Durable dedup belt (survives a crash between the commit below and complete()): sha256(userId|rfqId|key).
    const idemHash = createHash('sha256').update(`${userId}|${rfqId}|${idempotencyKey}`).digest();

    let stored: QuoteResponseDto;
    try {
      // Cheap gates first — all AFTER begin so a retry replays even after de-whitelisting (PR#30 lesson).
      await this.assertWhitelisted(userId);
      const rfq = await this.loadQuotableRfq(rfqId);
      if (rfq.collectorSub === userId) {
        throw failHttp(ErrorCode.QUOTE_ON_OWN_RFQ, HttpStatus.UNPROCESSABLE_ENTITY, "You can't quote your own RFQ");
      }
      const fractionContractId = rfq.fractionContractId;

      // Price bounds (service-level → clean 422, not a 500 from CHK_quotes_price) + aggregate i128 overflow.
      const price = BigInt(dto.pricePerFractionStroops);
      if (price < 1n || price > MAX_STROOPS) {
        throw failHttp(ErrorCode.QUOTE_INVALID_PRICE, HttpStatus.UNPROCESSABLE_ENTITY, 'Ask price per fraction is out of range');
      }
      const required = BigInt(dto.fractionCount);
      if (price * required > MAX_I128) {
        throw failHttp(ErrorCode.QUOTE_AMOUNT_OVERFLOW, HttpStatus.UNPROCESSABLE_ENTITY, 'Total quote amount is out of range');
      }

      // Validity: must be in the future; silently cap to the RFQ expiry.
      const requestedValidUntil = new Date(dto.validUntil);
      if (requestedValidUntil.getTime() <= Date.now()) {
        throw failHttp(ErrorCode.QUOTE_INVALID_VALIDITY, HttpStatus.UNPROCESSABLE_ENTITY, 'validUntil must be in the future');
      }
      const validUntilCapped = requestedValidUntil.getTime() > rfq.expiresAt.getTime();
      const cappedValidUntil = validUntilCapped ? rfq.expiresAt : requestedValidUntil;

      // Fast-fail 409 BEFORE the ~2.5s chain read (authoritative re-check stays under the lock). Exclude
      // lapsed quotes: a lapsed own quote is not a real conflict — it will be reaped in-txn, so rejecting it
      // here would trap the holder out of re-quoting a still-open RFQ (TOV-175 #370).
      if (await this.quotes.hasOpenQuoteForRfq(rfqId, userId, { excludeLapsed: true })) {
        throw failHttp(ErrorCode.QUOTE_ALREADY_OPEN, HttpStatus.CONFLICT, 'You already have an open quote on this RFQ');
      }

      // Resolve wallet + contract + read the on-chain balance (blocking, fail-closed) — all OUTSIDE the txn.
      const onchain = await this.resolveContractAndReadBalance(userId, fractionContractId);

      const saved = await this.quotes.runInTransaction(async (manager) => {
        // Serialize this holder's quotes on this token so concurrent quotes on different RFQs can't both
        // consume the same free balance (the free decision below is authoritative under this lock).
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [userId, fractionContractId]);
        // Reap the holder's own lapsed quotes first → frees the active slot + removes them from the locked-sum.
        await this.quotes.reapLapsed(manager, userId, fractionContractId);
        // Authoritative: runs AFTER the reap, so a plain status='open' check (matching the index) is correct.
        if (await this.quotes.hasOpenQuoteForRfq(rfqId, userId, { manager })) {
          throw failHttp(ErrorCode.QUOTE_ALREADY_OPEN, HttpStatus.CONFLICT, 'You already have an open quote on this RFQ');
        }
        const locked = await this.quotes.sumOpenLockedCount(manager, userId, fractionContractId);
        const free = onchain - locked;
        if (free < required) {
          throw this.insufficientFreeBalance(required, free);
        }
        // Fast-path re-assert of validity (JS clock). The DB `CHK_quotes_validity` (valid_until > created_at,
        // created_at = DB now()) is the authoritative belt; catch its 23514 below so multi-second app↔DB clock
        // skew maps to a clean 422 instead of a raw 500 (TOV-175 #378).
        if (cappedValidUntil.getTime() <= Date.now()) {
          throw failHttp(ErrorCode.QUOTE_RFQ_EXPIRED, HttpStatus.UNPROCESSABLE_ENTITY, 'The RFQ has expired');
        }
        // The .orIgnore in insertOpen targets ONLY UQ_quotes_idem. A 23505 on UQ_quotes_active_per_rfq is
        // unreachable here: same RFQ ⇒ same fraction_contract_id ⇒ same advisory lock, so the under-lock
        // hasOpenQuoteForRfq re-check above already converted any concurrent loser to a clean 409.
        let row: Awaited<ReturnType<IQuoteRepository['insertOpen']>>;
        try {
          row = await this.quotes.insertOpen(manager, {
            rfqId,
            holderSub: userId,
            fractionContractId,
            fractionCount: String(dto.fractionCount),
            pricePerFractionStroops: dto.pricePerFractionStroops,
            validUntil: cappedValidUntil,
            idempotencyKeyHash: idemHash,
          });
        } catch (err) {
          if (isCheckViolation(err, 'CHK_quotes_validity')) {
            throw failHttp(ErrorCode.QUOTE_RFQ_EXPIRED, HttpStatus.UNPROCESSABLE_ENTITY, 'The RFQ has expired');
          }
          throw err;
        }
        if (!row) {
          return null; // idem conflict → durable-backstop replay outside the txn
        }
        await this.audit.record(
          {
            actorType: 'user',
            actorId: userId,
            kind: AUDIT_KIND.QUOTE_SUBMITTED,
            subjectType: 'rfq_quote',
            subjectId: row.id,
            payload: {
              rfqId,
              fractionContractId,
              fractionCount: row.fractionCount,
              pricePerFractionStroops: row.pricePerFractionStroops,
            },
          },
          manager,
        );
        return row;
      });

      if (saved) {
        stored = QuoteResponseDto.fromEntity(saved, { validUntilCapped });
      } else {
        // Durable backstop: a same-key retry that raced past an evicted Redis key. Replay the existing row.
        // The persisted `valid_until` is already the capped value; only the ephemeral `validUntilCapped` HINT
        // is fresh/Redis-replay-only (there is no column to recover it from) — mirrors how RFQ treats its
        // fresh-only `balanceWarning`. A normal Redis replay returns the byte-identical stored body incl. the
        // hint; only this rare crash-window backstop omits it (TOV-175 #377).
        const existing = await this.quotes.findByIdempotency({ holderSub: userId, rfqId, idempotencyKeyHash: idemHash });
        if (!existing) {
          throw failHttp(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT, HttpStatus.CONFLICT, 'A quote with this key is still processing');
        }
        stored = QuoteResponseDto.fromEntity(existing);
      }
    } catch (err) {
      await this.idempotency.fail(key, token);
      throw err;
    }

    // Committed — OUTSIDE the fail-guard.
    await this.idempotency.complete(key, token, stored);
    return stored;
  }

  /** Identity-level KYC gate. */
  private async assertWhitelisted(userId: string): Promise<void> {
    const user = await this.users.findKycStatusByUserId(userId);
    if (!user || user.kycStatus !== KycStatus.WHITELISTED) {
      throw failHttp(ErrorCode.QUOTE_NOT_WHITELISTED, HttpStatus.FORBIDDEN, 'Complete KYC to submit a quote');
    }
  }

  /** Load the RFQ and assert it can be quoted: exists, still `open`, not expired. */
  private async loadQuotableRfq(rfqId: string): Promise<Rfq> {
    const rfq = await this.rfqs.findOneById(rfqId);
    if (!rfq) {
      throw failHttp(ErrorCode.QUOTE_RFQ_NOT_FOUND, HttpStatus.NOT_FOUND, 'RFQ not found');
    }
    if (rfq.status !== 'open') {
      throw failHttp(ErrorCode.QUOTE_RFQ_NOT_OPEN, HttpStatus.UNPROCESSABLE_ENTITY, 'This RFQ is no longer accepting quotes');
    }
    if (rfq.expiresAt.getTime() <= Date.now()) {
      throw failHttp(ErrorCode.QUOTE_RFQ_EXPIRED, HttpStatus.UNPROCESSABLE_ENTITY, 'This RFQ has expired');
    }
    return rfq;
  }

  /**
   * Resolve the holder's embedded (passkey) wallet + the RFQ's fraction token, then read the on-chain
   * FractionToken balance (blocking, fail-closed, bounded by QUOTE_BALANCE_TIMEOUT_MS). The embedded wallet is
   * the same money-path wallet bids/RFQ read and the sell source at accept-and-settle (FR-06.04).
   */
  private async resolveContractAndReadBalance(
    userId: string,
    fractionContractId: string,
  ): Promise<bigint> {
    // Read the balance of the holder's EMBEDDED passkey wallet — the same wallet the bids/RFQ money paths
    // read, and the wallet the fractions must transfer FROM at accept-and-settle (FR-06.04). Aligns the gate
    // with the eventual sell source (TOV-175 #381).
    let wallet: string;
    try {
      const resolution = await this.walletsService.resolveEmbeddedWalletForUser(userId);
      wallet = resolution.contractAddress;
    } catch (err) {
      if (err instanceof EmbeddedWalletNotFoundError) {
        throw failHttp(ErrorCode.QUOTE_NO_SETTLEMENT_WALLET, HttpStatus.UNPROCESSABLE_ENTITY, 'Set up your wallet to submit a quote');
      }
      throw err;
    }
    const contract = await this.contracts.findOneById(fractionContractId);
    if (!contract || contract.status !== 'deployed' || !contract.tokenAddress) {
      // A missing/undeployed contract for an RFQ that exists is a permanent invariant violation, not a
      // transient outage — terminal 422, not a retryable 503.
      throw failHttp(ErrorCode.QUOTE_RFQ_NOT_OPEN, HttpStatus.UNPROCESSABLE_ENTITY, 'This RFQ is no longer accepting quotes');
    }
    const tokenAddress = contract.tokenAddress;
    let onchain: bigint;
    try {
      // The deadline is passed INTO the read so the abandoned RPC socket is released at ~2.5s rather than
      // held to the shared 5s per-read timeout — no redundant outer wrapper (TOV-175 #374).
      const balances = await this.fractionRead.balancesOf([tokenAddress], wallet, {
        timeoutMs: QUOTE_BALANCE_TIMEOUT_MS,
      });
      onchain = parseAmount(balances.get(tokenAddress), 'balance', { nonNegative: true });
    } catch {
      // Any read failure / timeout / garbage value fails closed — no quote is created.
      throw failHttp(ErrorCode.QUOTE_BALANCE_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE, 'Fraction balance is temporarily unavailable');
    }
    return onchain;
  }

  /** 422 with the FULL filter envelope (raw HttpException — failHttp can't carry the extra count fields). */
  private insufficientFreeBalance(required: bigint, free: bigint): HttpException {
    return new HttpException(
      {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: 'Insufficient free fraction balance for this quote',
        errorCode: ErrorCode.QUOTE_INSUFFICIENT_FREE_BALANCE,
        requiredCount: required.toString(),
        freeBalance: (free < 0n ? 0n : free).toString(),
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
