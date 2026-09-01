import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ErrorCode } from '@common/enums/error-code.enum';
import { failHttp } from '@common/http/fail-http';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { IdempotencyStore } from '@common/idempotency/idempotency-store';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { AUDIT_KIND } from '@modules/wallets/audit/audit-log.types';
import {
  USER_REPOSITORY,
  IUserRepository,
} from '@modules/users/repositories/user-repository.interface';
import {
  ARTWORK_REPOSITORY,
  IArtworkRepository,
} from '@modules/fractionalization/repositories/artwork-repository.interface';
import {
  FRACTION_CONTRACT_REPOSITORY,
  IFractionContractRepository,
} from '@modules/fractionalization/repositories/fraction-contract-repository.interface';
import type { FractionContractStatus } from '@modules/fractionalization/entities/fraction-contract.entity';
import { MAX_STROOPS, MAX_I128 } from '@common/constants/stroops.constant';
import {
  RFQ_FANOUT_QUEUE,
  RFQ_FANOUT_JOB,
  RFQ_FANOUT_JOB_OPTS,
  RfqFanoutJobData,
} from '@modules/marketplace/notifications/constants/rfq-notification.constants';
import { RFQ_REPOSITORY, IRfqRepository } from './repositories/rfq-repository.interface';
import { RfqBalanceAdvisor } from './rfq-balance.advisor';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { RfqResponseDto } from './dto/rfq-response.dto';
import { DEFAULT_EXPIRY_HOURS, MAX_ACTIVE_OPEN_RFQS } from './constants/rfq.constant';

const DEPLOYED: FractionContractStatus = 'deployed';
const MS_PER_HOUR = 3_600_000;

/**
 * Orchestrates the public RFQ create surface (TOV-172, FR-06.01). Pure DB write — no on-chain leg. The
 * collector is owner-scoped to the JWT `sub`; nothing security-relevant comes from the request body.
 *
 * Validation order and idempotency mirror `OfferingBidsService.submit` / `BackofficeOfferingsService`:
 * idempotency `begin` precedes every state-derived rejection so a legit retry replays the original 201
 * (even after the collector is later de-whitelisted). The whole pre-commit region INCLUDING the committed
 * insert runs under one fail-guard — `fail()` releases the key ONLY on a pre-commit throw; `complete()` is
 * OUTSIDE the guard, so a post-commit blip never releases the key. Money is BigInt/string throughout.
 */
@Injectable()
export class RfqsService {
  private readonly logger = new Logger(RfqsService.name);

  constructor(
    @Inject(RFQ_REPOSITORY) private readonly rfqs: IRfqRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(ARTWORK_REPOSITORY) private readonly artworks: IArtworkRepository,
    @Inject(FRACTION_CONTRACT_REPOSITORY) private readonly contracts: IFractionContractRepository,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditLogService,
    private readonly balanceAdvisor: RfqBalanceAdvisor,
    @InjectQueue(RFQ_FANOUT_QUEUE) private readonly fanoutQueue: Queue<RfqFanoutJobData>,
  ) {}

  async create(userId: string, dto: CreateRfqDto, idempotencyKey: string): Promise<RfqResponseDto> {
    const key = `idem:rfq:${userId}:${idempotencyKey}`;
    // Canonicalize `expiry_hours` (default BEFORE hashing) so an omitted-vs-explicit-48 retry replays, not 422.
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          artworkId: dto.artworkId,
          fractionCount: dto.fractionCount,
          maxPricePerFractionStroops: dto.maxPricePerFractionStroops,
          expiryHours: dto.expiryHours ?? DEFAULT_EXPIRY_HOURS,
        }),
      )
      .digest('hex');

    const begin = await this.idempotency.begin(key, fingerprint);
    if (begin.outcome === 'replay') {
      // The stored snapshot is the exact `RfqResponseDto` persisted by a prior create's complete() (see the
      // warning-free `stored` below), so the cast is safe; the store round-trips it as opaque JSON.
      return begin.body as RfqResponseDto;
    }
    if (begin.outcome === 'in_flight') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT, HttpStatus.CONFLICT, 'An RFQ with this key is still processing');
    }
    if (begin.outcome === 'mismatch') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_MISMATCH, HttpStatus.UNPROCESSABLE_ENTITY, 'Idempotency-Key reused with a different body');
    }
    const { token } = begin;

    // Durable dedup belt (survives a crash between the commit below and complete()): sha256(userId|key).
    const idemHash = createHash('sha256').update(`${userId}|${idempotencyKey}`).digest();

    // Fail-guarded region (mirrors OfferingBidsService.submit): everything up to and INCLUDING the committed
    // insert. A throw here releases the idempotency key so a genuine retry can proceed. Nothing past the
    // commit runs under this guard, so fail() is NEVER called after a committed side effect.
    // `body` is the FRESH 201 (may carry balance_warning); `stored` is the replay snapshot persisted to the
    // idempotency store — always warning-free, so a Redis replay and the DB durable-backstop replay return an
    // IDENTICAL body. The advisory warning is a fresh-response-only concern (todo #358).
    let body: RfqResponseDto;
    let stored: RfqResponseDto;
    // Set ONLY on a genuinely-new insert (not the durable-backstop replay) so fan-out enqueues exactly once
    // per RFQ. Hoisted out of the try because `saved` is block-scoped there but the enqueue runs post-commit.
    let newRfqId: string | null = null;
    try {
      // 1. Whitelist gate (identity-level KYC). All state gates run AFTER begin → cached & replayable.
      const user = await this.users.findKycStatusByUserId(userId);
      if (!user || user.kycStatus !== KycStatus.WHITELISTED) {
        throw failHttp(ErrorCode.RFQ_NOT_WHITELISTED, HttpStatus.FORBIDDEN, 'Complete KYC to issue an RFQ');
      }

      // 2. Per-collector active-open ceiling (abuse control).
      const activeOpen = await this.rfqs.countActiveOpenByCollector(userId);
      if (activeOpen >= MAX_ACTIVE_OPEN_RFQS) {
        throw failHttp(ErrorCode.RFQ_TOO_MANY_ACTIVE, HttpStatus.UNPROCESSABLE_ENTITY, 'You have too many open RFQs');
      }

      // 3. Price bounds (service-level so an oversized value is a clean 422, not a 500 from CHK_rfqs_price).
      const price = BigInt(dto.maxPricePerFractionStroops);
      if (price < 1n || price > MAX_STROOPS) {
        throw failHttp(ErrorCode.RFQ_INVALID_PRICE, HttpStatus.UNPROCESSABLE_ENTITY, 'Max price per fraction is out of range');
      }
      // 4. Aggregate overflow: keep price × count within the i128 ceiling.
      const required = price * BigInt(dto.fractionCount);
      if (required > MAX_I128) {
        throw failHttp(ErrorCode.RFQ_AMOUNT_OVERFLOW, HttpStatus.UNPROCESSABLE_ENTITY, 'Total requested amount is out of range');
      }

      // 5. Artwork must exist.
      const artwork = await this.artworks.findOneById(dto.artworkId);
      if (!artwork) {
        throw failHttp(ErrorCode.ARTWORK_NOT_FOUND, HttpStatus.NOT_FOUND, 'Artwork not found');
      }

      // 6. Artwork must be fractionalized = a DEPLOYED fraction contract (authoritative signal, not artworks.status).
      const contract = await this.contracts.findActiveByArtworkId(dto.artworkId);
      if (!contract || contract.status !== DEPLOYED) {
        throw failHttp(ErrorCode.RFQ_ARTWORK_NOT_FRACTIONALIZED, HttpStatus.UNPROCESSABLE_ENTITY, 'Artwork is not fractionalized');
      }

      // 7. Soft-warn balance (best-effort; never throws, never blocks).
      const warning = await this.balanceAdvisor.warnIfInsufficient(userId, required);

      // 8. Insert the open RFQ + audit row in one transaction.
      const expiresAt = new Date(Date.now() + (dto.expiryHours ?? DEFAULT_EXPIRY_HOURS) * MS_PER_HOUR);
      const saved = await this.rfqs.runInTransaction(async (manager) => {
        const row = await this.rfqs.insertOpen(manager, {
          collectorSub: userId,
          artworkId: dto.artworkId,
          fractionContractId: contract.id,
          fractionCount: String(dto.fractionCount),
          maxPricePerFractionStroops: dto.maxPricePerFractionStroops,
          expiresAt,
          idempotencyKeyHash: idemHash,
        });
        if (!row) {
          // UQ_rfqs_idem conflict (ON CONFLICT DO NOTHING) — replayed outside the txn.
          return null;
        }
        await this.audit.record(
          {
            actorType: 'user',
            actorId: userId,
            kind: AUDIT_KIND.RFQ_CREATED,
            subjectType: 'rfq',
            subjectId: row.id,
            payload: {
              artworkId: dto.artworkId,
              fractionContractId: contract.id,
              fractionCount: row.fractionCount,
              maxPricePerFractionStroops: row.maxPricePerFractionStroops,
            },
          },
          manager,
        );
        return row;
      });

      if (saved) {
        newRfqId = saved.id;
        stored = RfqResponseDto.fromEntity(saved);
        body = warning ? RfqResponseDto.fromEntity(saved, warning) : stored;
      } else {
        // Durable-backstop replay: a prior request with the same (collector, Idempotency-Key) already
        // committed this RFQ. Return the persisted row (no balance_warning — it is ephemeral, not stored).
        const existing = await this.rfqs.findOne({
          where: { collectorSub: userId, idempotencyKeyHash: idemHash },
        });
        if (!existing) {
          // Conflict but no visible row (a concurrent in-flight commit) — tell the client to retry.
          throw failHttp(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT, HttpStatus.CONFLICT, 'An RFQ with this key is still processing');
        }
        stored = RfqResponseDto.fromEntity(existing);
        body = stored;
      }
    } catch (err) {
      await this.idempotency.fail(key, token);
      throw err;
    }

    // Committed — OUTSIDE the fail-guard, so a Redis blip in complete() never releases the key. Persist the
    // warning-FREE `stored` snapshot so every replay (Redis or DB-backstop) returns the same body.
    await this.idempotency.complete(key, token, stored);

    // TOV-174: enqueue the holder notification fan-out. Best-effort + post-complete(): a Redis/BullMQ outage
    // must never fail the already-committed 201 — the reconcile sweep re-drives an RFQ whose enqueue was
    // lost. Only on a genuinely-new insert (`newRfqId`); the durable-replay branch must not re-enqueue.
    // `jobId=rfqId` dedups; correctness rests on the DB latch + unique index, not on jobId.
    if (newRfqId) {
      try {
        // jobId=rfqId dedups a duplicate create-time enqueue; the reconcile backstop uses a distinct jobId
        // (todo 361). Options shared via RFQ_FANOUT_JOB_OPTS so producer + reconcile never drift.
        await this.fanoutQueue.add(RFQ_FANOUT_JOB, { rfqId: newRfqId }, { jobId: newRfqId, ...RFQ_FANOUT_JOB_OPTS });
      } catch (err) {
        this.logger.warn(`rfq-fanout enqueue failed [rfq=${newRfqId}] — reconcile will re-drive: ${String(err)}`);
      }
    }
    return body;
  }
}
