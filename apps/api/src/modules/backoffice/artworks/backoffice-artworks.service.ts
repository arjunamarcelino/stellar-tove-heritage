import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { In } from 'typeorm';
import { createHash } from 'node:crypto';
import { ErrorCode } from '@common/enums/error-code.enum';
import { failHttp } from '@common/http/fail-http';
import { isUniqueConstraintError } from '@common/utils/database.utils';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { IdempotencyStore } from '@common/idempotency/idempotency-store';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { AUDIT_KIND } from '@modules/wallets/audit/audit-log.types';
import { WalletsService } from '@modules/wallets/wallets.service';
import { fractionFactoryConfig } from '@config/fraction-factory.config';
import {
  ARTWORK_REPOSITORY,
  IArtworkRepository,
} from '@modules/fractionalization/repositories/artwork-repository.interface';
import {
  FRACTION_CONTRACT_REPOSITORY,
  IFractionContractRepository,
} from '@modules/fractionalization/repositories/fraction-contract-repository.interface';
import {
  OFFERING_REPOSITORY,
  IOfferingRepository,
} from '@modules/offerings/repositories/offering-repository.interface';
import { FractionContract } from '@modules/fractionalization/entities/fraction-contract.entity';
import { FRACTION_DEPLOY_QUEUE } from '@modules/fractionalization/fraction.constants';
import { FractionalizeArtworkDto } from './dto/fractionalize-artwork.dto';
import { FractionalizationResponseDto } from './dto/fractionalization-response.dto';
import { ArtworkQueryDto } from './dto/artwork-query.dto';
import { ArtworkListItemDto } from './dto/artwork-list-item.dto';
import { ArtworkDetailDto } from './dto/artwork-detail.dto';
import { OfferingPreviewQueryDto } from './dto/offering-preview-query.dto';
import { OfferingPreviewDto } from './dto/offering-preview.dto';
import { assertBandValid, resolveOfferableFloat } from '@modules/offerings/offering-planning.helpers';
import { DEFAULT_ARTWORK_LIST_STATUSES } from './backoffice-artworks.constants';

const UNIQUE_ACTIVE_INDEX = 'UQ_fraction_contracts_active_per_artwork';

/**
 * Admin-only fractionalize orchestration (TOV-233, sync phase). Idempotency `begin` precedes every
 * state-derived rejection (PR#30 KYC lesson) so a legit same-key retry replays the original 202. The
 * authoritative dedup is the single-writer CAS `verified → fractionalizing` inside a short txn; the
 * on-chain deploy runs later in the BullMQ worker.
 */
@Injectable()
export class BackofficeArtworksService {
  constructor(
    @Inject(ARTWORK_REPOSITORY) private readonly artworks: IArtworkRepository,
    @Inject(FRACTION_CONTRACT_REPOSITORY) private readonly contracts: IFractionContractRepository,
    private readonly wallets: WalletsService,
    @Inject(fractionFactoryConfig.KEY) private readonly cfg: ConfigType<typeof fractionFactoryConfig>,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditLogService,
    @InjectQueue(FRACTION_DEPLOY_QUEUE) private readonly deployQueue: Queue,
    @Inject(OFFERING_REPOSITORY) private readonly offerings: IOfferingRepository,
  ) {}

  async fractionalize(
    artworkId: string,
    dto: FractionalizeArtworkDto,
    adminSub: string,
    idempotencyKey: string,
  ): Promise<FractionalizationResponseDto> {
    // 1. Config-driven bounds (fail fast before spending an on-chain tx).
    if (dto.total_supply > this.cfg.maxTotalSupply) {
      throw failHttp(ErrorCode.VALIDATION_FAILED, HttpStatus.UNPROCESSABLE_ENTITY, 'total_supply exceeds the configured maximum');
    }
    if (dto.artist_lockup_days > this.cfg.maxLockupDays || dto.treasury_lockup_days > this.cfg.maxLockupDays) {
      throw failHttp(ErrorCode.VALIDATION_FAILED, HttpStatus.UNPROCESSABLE_ENTITY, 'lockup_days exceeds the configured maximum');
    }

    // 2-3. Idempotency (scoped by admin sub + artwork id) BEFORE any state-derived rejection.
    const key = `idem:fractionalize:${adminSub}:${idempotencyKey}`;
    const fingerprint = this.fingerprint(adminSub, artworkId, dto);
    const begin = await this.idempotency.begin(key, fingerprint);
    if (begin.outcome === 'replay') return begin.body as FractionalizationResponseDto;
    if (begin.outcome === 'in_flight') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT, HttpStatus.CONFLICT, 'A fractionalize request with this key is still processing');
    }
    if (begin.outcome === 'mismatch') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_MISMATCH, HttpStatus.UNPROCESSABLE_ENTITY, 'Idempotency-Key reused with a different request body');
    }
    const { token } = begin;

    try {
      // 4. Load artwork.
      const artwork = await this.artworks.findOneById(artworkId);
      if (!artwork) {
        throw failHttp(ErrorCode.ARTWORK_NOT_FOUND, HttpStatus.NOT_FOUND, 'Artwork not found');
      }

      // 5. State guard — only `verified` is fractionalizable.
      if (artwork.status !== 'verified') {
        throw this.notFractionalizable(artwork.status);
      }

      // 6. Resolve the artist's primary settlement wallet (snapshot at request time — TOCTOU freeze).
      const artistAddress = await this.wallets.resolvePrimarySettlementAddress(artwork.artistUserId);
      if (!artistAddress) {
        throw failHttp(ErrorCode.ARTIST_NO_PRIMARY_WALLET, HttpStatus.UNPROCESSABLE_ENTITY, 'Artwork owner has no primary settlement wallet');
      }

      // 7. Short txn: CAS the artwork + insert the deploying row + write the requested audit.
      const saved = await this.artworks.runInTransaction(async (manager) => {
        const moved = await this.artworks.casStatus(manager, artworkId, 'verified', 'fractionalizing');
        if (!moved) {
          // Lost the race to a concurrent request.
          throw failHttp(ErrorCode.ARTWORK_FRACTIONALIZATION_IN_PROGRESS, HttpStatus.CONFLICT, 'A fractionalization is already in progress for this artwork');
        }
        const repo = manager.getRepository(FractionContract);
        const row = repo.create({
          artworkId,
          status: 'deploying',
          wasmHash: this.cfg.tokenWasmHash,
          tokenName: dto.name,
          tokenSymbol: dto.symbol,
          artistAddress,
          totalSupply: String(dto.total_supply),
          artistRetentionPct: dto.artist_retention_pct,
          treasuryRetentionPct: dto.treasury_retention_pct,
          artistLockupDays: dto.artist_lockup_days,
          treasuryLockupDays: dto.treasury_lockup_days,
        });
        let inserted: FractionContract;
        try {
          inserted = await repo.save(row);
        } catch (err) {
          if (isUniqueConstraintError(err, UNIQUE_ACTIVE_INDEX)) {
            throw failHttp(ErrorCode.ARTWORK_FRACTIONALIZATION_IN_PROGRESS, HttpStatus.CONFLICT, 'A fractionalization is already in progress for this artwork');
          }
          throw err;
        }
        await this.audit.record(
          {
            actorType: 'admin',
            actorId: adminSub,
            kind: AUDIT_KIND.ARTWORK_FRACTIONALIZATION_REQUESTED,
            subjectType: 'artwork',
            subjectId: artworkId,
            payload: {
              fractionContractId: inserted.id,
              totalSupply: inserted.totalSupply,
              artistRetentionPct: dto.artist_retention_pct,
              treasuryRetentionPct: dto.treasury_retention_pct,
              artistLockupDays: dto.artist_lockup_days,
              treasuryLockupDays: dto.treasury_lockup_days,
              tokenName: dto.name,
              tokenSymbol: dto.symbol,
              artistAddress,
            },
          },
          manager,
        );
        return inserted;
      });

      // 8. Enqueue after commit (jobId = row id dedups a duplicate enqueue).
      await this.deployQueue.add(
        'deploy',
        { fractionContractId: saved.id },
        {
          jobId: saved.id,
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { age: 3600, count: 100 },
          removeOnFail: { age: 86400 },
        },
      );

      // 9. Record the 202 snapshot under the key and return it.
      const body = FractionalizationResponseDto.fromEntity(saved);
      await this.idempotency.complete(key, token, body);
      return body;
    } catch (err) {
      await this.idempotency.fail(key, token);
      throw err;
    }
  }

  /** Pure read: the latest fraction_contracts row for the artwork — INCLUDING a terminal `failed`
   * attempt, so an admin who watched a deploy fail sees `failed`, not a 404 (404 = never requested). */
  async getStatus(artworkId: string): Promise<FractionalizationResponseDto> {
    const row = await this.contracts.findLatestByArtworkId(artworkId);
    if (!row) {
      throw failHttp(ErrorCode.ARTWORK_NOT_FOUND, HttpStatus.NOT_FOUND, 'No fractionalization found for this artwork');
    }
    return FractionalizationResponseDto.fromEntity(row);
  }

  /**
   * Admin artwork list (TOV-240). Two queries, no N+1: page the artworks, then batch-fetch their active
   * fraction contracts and zip in memory. `deleted_at IS NULL` is applied automatically by `findAndCount`.
   *
   * The two reads are intentionally NOT transactional. `fraction_contracts.status` is the source of truth
   * and `artworks.status` a derived latch advanced in the same CAS txn (see `fractionalization/CLAUDE.md`),
   * so a reader can only observe a transient, self-healing display skew — never a persisted inconsistency.
   * Do not wrap this in a transaction: it would add lock cost for zero correctness benefit. (Same for
   * `getArtwork`; the CTA gate keys on `fractionContract == null`, which is authoritative.)
   */
  async listArtworks(query: ArtworkQueryDto): Promise<PaginatedResponseDto<ArtworkListItemDto>> {
    const statuses = query.status?.length ? query.status : DEFAULT_ARTWORK_LIST_STATUSES;
    const [artworks, total] = await this.artworks.findWithPagination(
      { where: { status: In(statuses) }, order: { createdAt: 'DESC' } },
      query.page,
      query.limit,
    );

    const active = await this.contracts.findActiveByArtworkIds(artworks.map((a) => a.id));
    const byArtwork = new Map(active.map((c) => [c.artworkId, c]));
    const rows = artworks.map((a) => ArtworkListItemDto.fromEntity(a, byArtwork.get(a.id) ?? null));

    return PaginatedResponseDto.create(rows, total, query.page, query.limit);
  }

  /**
   * Admin artwork detail + active-only fraction projection + active offering embed (TOV-240 / TOV-153).
   * 404 when missing/soft-deleted. The two projections are independent once existence is known, so they
   * run in parallel. Non-transactional (same rationale as `listArtworks`): both statuses are self-healing
   * latches, so a reader can only observe a transient display skew, never a persisted inconsistency.
   */
  async getArtwork(artworkId: string): Promise<ArtworkDetailDto> {
    const artwork = await this.artworks.findOneById(artworkId);
    if (!artwork) {
      // module-local `failHttp` idiom (matches fractionalize above) — intentionally not NestJS NotFoundException.
      throw failHttp(ErrorCode.ARTWORK_NOT_FOUND, HttpStatus.NOT_FOUND, 'Artwork not found');
    }
    // active-only (NOT findLatest): a prior `failed` deploy → null → the Fractionalize CTA re-shows (Decision #1).
    const [active, activeOffering] = await Promise.all([
      this.contracts.findActiveByArtworkId(artworkId),
      this.offerings.findActiveByArtworkId(artworkId),
    ]);
    return ArtworkDetailDto.fromEntity(artwork, active, activeOffering);
  }

  /**
   * Stateless offering-planning preview (TOV-153): server-authoritative public float + band-aware
   * estimated raise range, computed with the SAME primitives the POST path snapshots (so a preview that
   * shows "valid" can never fail on submit). Read-only — touches no offering row (existence gating is the
   * embed's / the POST unique-index's job).
   */
  async offeringPreview(artworkId: string, query: OfferingPreviewQueryDto): Promise<OfferingPreviewDto> {
    // Band validated FIRST → 422 before 404 (exact POST parity). Narrow on BOTH bounds so the compiler
    // proves `high` is a string (no `!` assertion); the "only low" state is unreachable post-validation
    // because OfferingPreviewQueryDto's paired-optional rule 400s a lone bound before the service runs.
    const band =
      query.low_price_stroops !== undefined && query.high_price_stroops !== undefined
        ? assertBandValid(query.low_price_stroops, query.high_price_stroops)
        : undefined;

    const artwork = await this.artworks.findOneById(artworkId);
    if (!artwork) {
      throw failHttp(ErrorCode.ARTWORK_NOT_FOUND, HttpStatus.NOT_FOUND, 'Artwork not found');
    }

    const resolved = resolveOfferableFloat(await this.contracts.findActiveByArtworkId(artworkId));
    return OfferingPreviewDto.build(resolved, band);
  }

  private notFractionalizable(status: string) {
    if (status === 'fractionalized') {
      return failHttp(ErrorCode.ARTWORK_ALREADY_FRACTIONALIZED, HttpStatus.CONFLICT, 'Artwork is already fractionalized');
    }
    if (status === 'fractionalizing') {
      return failHttp(ErrorCode.ARTWORK_FRACTIONALIZATION_IN_PROGRESS, HttpStatus.CONFLICT, 'A fractionalization is already in progress for this artwork');
    }
    return failHttp(ErrorCode.ARTWORK_NOT_FRACTIONALIZABLE, HttpStatus.CONFLICT, 'Artwork is not in a fractionalizable state');
  }

  private fingerprint(adminSub: string, artworkId: string, dto: FractionalizeArtworkDto): string {
    const canonical = JSON.stringify({
      total_supply: dto.total_supply,
      artist_retention_pct: dto.artist_retention_pct,
      treasury_retention_pct: dto.treasury_retention_pct,
      artist_lockup_days: dto.artist_lockup_days,
      treasury_lockup_days: dto.treasury_lockup_days,
      name: dto.name,
      symbol: dto.symbol,
    });
    return createHash('sha256').update(`${adminSub}|${artworkId}|${canonical}`).digest('hex');
  }
}
