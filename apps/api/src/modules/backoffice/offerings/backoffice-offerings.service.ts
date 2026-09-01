import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IsNull } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { ErrorCode } from '@common/enums/error-code.enum';
import { failHttp } from '@common/http/fail-http';
import { isUniqueConstraintError } from '@common/utils/database.utils';
import { IdempotencyStore } from '@common/idempotency/idempotency-store';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { AUDIT_KIND } from '@modules/wallets/audit/audit-log.types';
import { offeringEscrowConfig } from '@config/offering-escrow.config';
import {
  OFFERING_REPOSITORY,
  IOfferingRepository,
} from '@modules/offerings/repositories/offering-repository.interface';
import {
  OFFERING_APPROVAL_REPOSITORY,
  IOfferingApprovalRepository,
} from '@modules/offerings/repositories/offering-approval-repository.interface';
import { Offering } from '@modules/offerings/entities/offering.entity';
import {
  OFFERING_STATUSES,
  ACTIVE_OFFERING_STATUSES,
  OfferingStatus,
} from '@modules/offerings/constants/offering-status.constant';
import { OFFERING_ESCROW_DEPLOY_QUEUE } from '@modules/offerings/offering.constants';
import {
  ARTWORK_REPOSITORY,
  IArtworkRepository,
} from '@modules/fractionalization/repositories/artwork-repository.interface';
import {
  FRACTION_CONTRACT_REPOSITORY,
  IFractionContractRepository,
} from '@modules/fractionalization/repositories/fraction-contract-repository.interface';
import { assertBandValid, resolveOfferableFloat } from '@modules/offerings/offering-planning.helpers';
import { deriveSettlementPhase } from './settlement-phase';
import { CreateOfferingDto } from './dto/create-offering.dto';
import { OfferingResponseDto } from './dto/offering-response.dto';
import { ApproveOfferingResponseDto } from './dto/approve-offering-response.dto';
import { OfferingDetailDto } from './dto/offering-detail.dto';
import { OfferingListQueryDto } from './dto/offering-list.query.dto';

const UNIQUE_ACTIVE_INDEX = 'UQ_offerings_active_per_artwork';

/**
 * Admin-only offering-planning orchestration (TOV-152, FR-05.01). A sibling of `fractionalize()` but a pure
 * DB write — no Soroban call, no BullMQ worker. Idempotency `begin` precedes every state-derived rejection
 * (PR#30 KYC lesson) so a legit same-key retry replays the original 201; the authoritative one-active guard
 * is the `UQ_offerings_active_per_artwork` partial index + 23505 catch (no pre-check SELECT).
 */
@Injectable()
export class BackofficeOfferingsService {
  private readonly logger = new Logger(BackofficeOfferingsService.name);

  constructor(
    @Inject(OFFERING_REPOSITORY) private readonly offerings: IOfferingRepository,
    @Inject(OFFERING_APPROVAL_REPOSITORY) private readonly approvals: IOfferingApprovalRepository,
    @Inject(ARTWORK_REPOSITORY) private readonly artworks: IArtworkRepository,
    @Inject(FRACTION_CONTRACT_REPOSITORY) private readonly contracts: IFractionContractRepository,
    @Inject(offeringEscrowConfig.KEY) private readonly escrowCfg: ConfigType<typeof offeringEscrowConfig>,
    @InjectQueue(OFFERING_ESCROW_DEPLOY_QUEUE) private readonly deployQueue: Queue,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditLogService,
  ) {}

  async create(
    dto: CreateOfferingDto,
    adminSub: string,
    idempotencyKey: string,
  ): Promise<OfferingResponseDto> {
    // 1. Band validation (pure body, fail fast before idempotency). Shared with the TOV-153 preview via
    // `assertBandValid` so the two paths accept/reject a band identically — the `<= 2^96-1` bound is
    // load-bearing (an oversized price would otherwise violate `CHK_off_band` at save() as an uncaught 500).
    assertBandValid(dto.low_price_stroops, dto.high_price_stroops);

    // 2. Window validation. Only `open < close` is enforced — a window entirely in the past is intentionally
    // ALLOWED at planning (todo 265, FR-05.01 decision). The later M05 open/settle FRs MUST re-validate
    // `window_*` against `now`, or a stale offering could be opened/settled. The `Number.isNaN` guard is
    // defense-in-depth: a calendar-invalid string should be caught at 400 by `@IsISO8601({ strict })`, but a
    // NaN date must never slip to the insert (`NaN >= NaN` is false).
    const openMs = new Date(dto.window_open_at).getTime();
    const closeMs = new Date(dto.window_close_at).getTime();
    if (Number.isNaN(openMs) || Number.isNaN(closeMs) || openMs >= closeMs) {
      throw failHttp(ErrorCode.OFFERING_WINDOW_INVALID, HttpStatus.UNPROCESSABLE_ENTITY, 'window_open_at must be strictly before window_close_at');
    }

    // 3. Idempotency (scoped by admin sub) BEFORE any state-derived rejection.
    const key = `idem:offering-plan:${adminSub}:${idempotencyKey}`;
    const fingerprint = this.fingerprint(adminSub, dto);
    const begin = await this.idempotency.begin(key, fingerprint);
    // `begin.body` is the JSON-parsed stored 201 (a plain object, not a class instance). Safe to return
    // directly because the response is serialized as plain JSON with no class-based transform — fresh and
    // replay paths produce identical wire output. If a ClassSerializerInterceptor (excludeExtraneousValues)
    // is ever added globally, reconstruct via a fromPlain()/plainToInstance here so replay doesn't diverge.
    if (begin.outcome === 'replay') return begin.body as OfferingResponseDto;
    if (begin.outcome === 'in_flight') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT, HttpStatus.CONFLICT, 'An offering-plan request with this key is still processing');
    }
    if (begin.outcome === 'mismatch') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_MISMATCH, HttpStatus.UNPROCESSABLE_ENTITY, 'Idempotency-Key reused with a different request body');
    }
    const { token } = begin;

    try {
      // 4a. Load artwork (soft-delete filtered).
      const artwork = await this.artworks.findOneById(dto.artwork_id);
      if (!artwork) {
        throw failHttp(ErrorCode.ARTWORK_NOT_FOUND, HttpStatus.NOT_FOUND, 'Artwork not found');
      }

      // 4b-4c. Resolve the deployed fraction_contract + public float (the float source). Shared with the
      // TOV-153 preview via `resolveOfferableFloat` (→ 409 not-fractionalized / 422 no-float).
      const {
        contract: fc,
        publicFloat,
        totalSupply,
        artistRetentionAmount,
        treasuryRetentionAmount,
      } = resolveOfferableFloat(await this.contracts.findActiveByArtworkId(dto.artwork_id));

      // 4d. Insert the planned offering + write the audit row atomically.
      const saved = await this.offerings.runInTransaction(async (manager) => {
        const repo = manager.getRepository(Offering);
        const row = repo.create({
          artworkId: dto.artwork_id,
          fractionContractId: fc.id,
          status: 'planned',
          lowPriceStroops: dto.low_price_stroops,
          highPriceStroops: dto.high_price_stroops,
          publicFloat: String(publicFloat),
          // Freeze the supply/retention snapshot (TOV-165) alongside public_float — the settle worker copies
          // these into offering_clearing_audit so the mint invariant is self-contained (no fraction_contracts
          // re-read). Satisfies CHK_off_public_float_decomposition by construction (same fc, same instant).
          totalSupplyStroops: totalSupply,
          artistRetentionStroops: artistRetentionAmount,
          treasuryRetentionStroops: treasuryRetentionAmount,
          windowOpenAt: new Date(dto.window_open_at),
          windowCloseAt: new Date(dto.window_close_at),
          createdByAdminSub: adminSub,
        });
        let inserted: Offering;
        try {
          inserted = await repo.save(row);
        } catch (err) {
          // Sole authoritative one-active guard — no pre-check SELECT (matches the fractionalize sibling).
          if (isUniqueConstraintError(err, UNIQUE_ACTIVE_INDEX)) {
            throw failHttp(ErrorCode.OFFERING_ALREADY_ACTIVE, HttpStatus.CONFLICT, 'Artwork already has an active offering');
          }
          throw err;
        }
        await this.audit.record(
          {
            actorType: 'admin',
            actorId: adminSub,
            kind: AUDIT_KIND.OFFERING_PLANNED,
            subjectType: 'offering',
            subjectId: inserted.id,
            payload: {
              artworkId: dto.artwork_id,
              fractionContractId: fc.id,
              lowPriceStroops: dto.low_price_stroops,
              highPriceStroops: dto.high_price_stroops,
              publicFloat: String(publicFloat),
              windowOpenAt: new Date(dto.window_open_at).toISOString(),
              windowCloseAt: new Date(dto.window_close_at).toISOString(),
            },
          },
          manager,
        );
        return inserted;
      });

      // 4e. Record the 201 snapshot under the key and return it.
      const body = OfferingResponseDto.fromEntity(saved);
      await this.idempotency.complete(key, token, body);
      return body;
    } catch (err) {
      await this.idempotency.fail(key, token);
      throw err;
    }
  }

  /**
   * Record one admin's approval (TOV-154, FR-05.02). App-level 2-of-3 quorum: only rostered admins may
   * approve; on reaching the threshold the escrow deploy is CAS-claimed and enqueued. Idempotency `begin`
   * precedes every state-derived rejection (replay-safe). `FOR UPDATE` serializes concurrent quorum-reaching
   * approvals so `casEscrowDeploying` has exactly one winner (enqueue-once). Returns 202 for both a recorded
   * and a quorum-reaching approval.
   */
  async approve(
    offeringId: string,
    adminSub: string,
    idempotencyKey: string,
  ): Promise<ApproveOfferingResponseDto> {
    // Roster is the gate (not the admin role) — a rostered ADMIN or SUPERADMIN may approve.
    if (!this.escrowCfg.signerSet.has(adminSub)) {
      throw failHttp(ErrorCode.OFFERING_APPROVAL_NOT_A_SIGNER, HttpStatus.FORBIDDEN, 'Admin is not an approval signer');
    }

    const key = `idem:offering-approve:${adminSub}:${idempotencyKey}`;
    const begin = await this.idempotency.begin(key, this.approveFingerprint(offeringId, adminSub));
    if (begin.outcome === 'replay') return begin.body as ApproveOfferingResponseDto;
    if (begin.outcome === 'in_flight') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT, HttpStatus.CONFLICT, 'An approval with this key is still processing');
    }
    if (begin.outcome === 'mismatch') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_MISMATCH, HttpStatus.UNPROCESSABLE_ENTITY, 'Idempotency-Key reused with a different request');
    }
    const { token } = begin;

    let result: { count: number; claimed: boolean };
    try {
      result = await this.offerings.runInTransaction(async (manager) => {
        const off = await manager.getRepository(Offering).findOne({
          where: { id: offeringId, deletedAt: IsNull() },
          lock: { mode: 'pessimistic_write' },
        });
        if (!off) throw failHttp(ErrorCode.OFFERING_NOT_FOUND, HttpStatus.NOT_FOUND, 'Offering not found');
        if (off.status !== 'planned') {
          throw failHttp(ErrorCode.OFFERING_NOT_PLANNED, HttpStatus.CONFLICT, 'Offering is not in a planned state');
        }
        // 'failed' falls through so a rostered signer can retry (Enhancement #4); in-flight/done blocks.
        if (off.escrowDeployStatus === 'deploying' || off.escrowDeployStatus === 'deployed') {
          throw failHttp(ErrorCode.OFFERING_APPROVAL_IN_PROGRESS, HttpStatus.CONFLICT, 'Escrow deploy already in progress');
        }

        // Freeze the money-routing recipient the approvers attest to, on the FIRST approval (Enhancement #1).
        if (!off.snapshotArtistAddress) {
          const fc = await this.contracts.findOneById(off.fractionContractId);
          if (!fc) {
            throw failHttp(ErrorCode.OFFERING_ARTWORK_NOT_FRACTIONALIZED, HttpStatus.CONFLICT, 'Fraction contract not found');
          }
          await this.offerings.setSnapshotArtistAddress(manager, off.id, fc.artistAddress);
        }

        await this.approvals.insertSignature(manager, off.id, adminSub);
        const count = await this.approvals.countLiveSigners(off.id, this.escrowCfg.signerSet, manager);
        let claimed = false;
        if (count >= this.escrowCfg.threshold) {
          claimed = await this.offerings.casEscrowDeploying(manager, off.id);
        }
        await this.audit.record(
          {
            actorType: 'admin',
            actorId: adminSub,
            kind: AUDIT_KIND.OFFERING_APPROVAL_SIGNED,
            subjectType: 'offering',
            subjectId: off.id,
            payload: { count },
          },
          manager,
        );
        return { count, claimed };
      });
    } catch (err) {
      // Only the DB txn is guarded by fail() — a rolled-back approval releases the key for retry.
      await this.idempotency.fail(key, token);
      throw err;
    }

    // The txn committed. Record the idempotency result BEFORE the enqueue so a same-key retry always
    // replays this 202 (todo 283: never fail() the key after a committed side effect).
    const body = await this.buildApproveResponse(offeringId, result.count);
    // Best-effort (#335, matching settle()): a post-commit complete() blip must not skip the enqueue below —
    // the record is a replay convenience, the durable state already committed.
    await this.idempotency.complete(key, token, body).catch((err) => {
      this.logger.warn(`approve idempotency.complete failed [offering=${offeringId}]: ${String(err)}`);
    });

    if (result.claimed) {
      // Best-effort enqueue with a per-attempt jobId (the DB CAS is the true enqueue-once guard). A failure
      // here (Redis blip / crash) leaves the row in `deploying`; the reconcile stale-deploying sweep
      // re-drives it. Deliberately NON-fatal — the approval is already durably committed.
      try {
        await this.deployQueue.add(
          'deploy',
          { offeringId },
          {
            jobId: `deploy:${offeringId}:${randomUUID()}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: { age: 3600, count: 100 },
            removeOnFail: { age: 86400 },
          },
        );
      } catch (err) {
        this.logger.warn(
          `escrow deploy enqueue failed [offering=${offeringId}]; reconcile will re-drive: ${String(err)}`,
        );
      }
    }
    return body;
  }

  /** Paginated approval work-queue (`GET /offerings`). Roster-intersected counts + per-caller `youApproved`. */
  async list(
    query: OfferingListQueryDto,
    adminSub: string,
  ): Promise<PaginatedResponseDto<OfferingDetailDto>> {
    const statuses = this.parseStatuses(query.status);
    const [rows, total] = await this.offerings.listForBackoffice({
      statuses,
      artworkId: query.artworkId,
      page: query.page,
      limit: query.limit,
    });
    const summaries = rows.length
      ? await this.approvals.approvalSummariesFor(rows.map((r) => r.id), this.escrowCfg.signerSet, adminSub)
      : new Map<string, { count: number; youApproved: boolean }>();
    // One view DTO for both list + detail (todo 291); the list rows just omit `signers`. One clock reading per
    // page (TOV-165 G7) so two offerings straddling the same window_close_at can't render inconsistent phases.
    const now = new Date();
    const items = rows.map((r) => {
      const s = summaries.get(r.id) ?? { count: 0, youApproved: false };
      return OfferingDetailDto.build(
        r,
        { count: s.count, threshold: this.escrowCfg.threshold, youApproved: s.youApproved },
        deriveSettlementPhase(r, now),
      );
    });
    return PaginatedResponseDto.create(items, total, query.page, query.limit);
  }

  /** Single offering read / 202-poll target (`GET /offerings/:id`). */
  async getOne(offeringId: string, adminSub: string): Promise<OfferingDetailDto> {
    const off = await this.offerings.findOneById(offeringId);
    if (!off) throw failHttp(ErrorCode.OFFERING_NOT_FOUND, HttpStatus.NOT_FOUND, 'Offering not found');
    const summary =
      (await this.approvals.approvalSummariesFor([off.id], this.escrowCfg.signerSet, adminSub)).get(off.id) ??
      { count: 0, youApproved: false };
    // Aggregate only — raw approver identities are NOT exposed (anti-collusion, TOV-155).
    return OfferingDetailDto.build(
      off,
      { count: summary.count, threshold: this.escrowCfg.threshold, youApproved: summary.youApproved },
      deriveSettlementPhase(off, new Date()),
    );
  }

  private async buildApproveResponse(offeringId: string, count: number): Promise<ApproveOfferingResponseDto> {
    const off = await this.offerings.findOneById(offeringId);
    // The offering existed inside the just-committed txn; a null here is a genuine invariant break.
    if (!off) throw failHttp(ErrorCode.OFFERING_NOT_FOUND, HttpStatus.NOT_FOUND, 'Offering not found');
    // The calling admin just recorded a signature, so youApproved is true. Aggregate only (no signer list).
    return ApproveOfferingResponseDto.build(off, {
      count,
      threshold: this.escrowCfg.threshold,
      youApproved: true,
    });
  }

  /** Default to the non-terminal active set; a CSV `status` filter is validated against OFFERING_STATUSES. */
  private parseStatuses(csv?: string): readonly OfferingStatus[] {
    if (!csv || !csv.trim()) return ACTIVE_OFFERING_STATUSES;
    const parts = csv.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return ACTIVE_OFFERING_STATUSES;
    // Widen the haystack (todo 290) rather than casting the needle — `p` stays a real `string` so the
    // membership test actually validates it before the `parts as OfferingStatus[]` return below.
    const invalid = parts.filter((p) => !(OFFERING_STATUSES as readonly string[]).includes(p));
    if (invalid.length) {
      throw failHttp(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, `Invalid status filter: ${invalid.join(',')}`);
    }
    return parts as OfferingStatus[];
  }

  private approveFingerprint(offeringId: string, adminSub: string): string {
    // The approve body is empty; the key identity is (admin, offering). A same-admin, same-key retry replays.
    return createHash('sha256').update(`${adminSub}|${offeringId}`).digest('hex');
  }

  private fingerprint(adminSub: string, dto: CreateOfferingDto): string {
    // Canonicalize the timestamps to their UTC instant before hashing (the values are already validated
    // parseable by step 2). Two timezone-equivalent-but-differently-serialized windows (`…Z` vs `…000Z`
    // vs `…+00:00`) must fingerprint identically, so a legit same-key retry replays the 201 instead of
    // hitting a false IDEMPOTENCY_KEY_MISMATCH — mirroring the STROOPS_RE canonicalization of the amounts.
    const canonical = JSON.stringify({
      low_price_stroops: dto.low_price_stroops,
      high_price_stroops: dto.high_price_stroops,
      window_open_at: new Date(dto.window_open_at).toISOString(),
      window_close_at: new Date(dto.window_close_at).toISOString(),
    });
    return createHash('sha256').update(`${adminSub}|${dto.artwork_id}|${canonical}`).digest('hex');
  }
}
