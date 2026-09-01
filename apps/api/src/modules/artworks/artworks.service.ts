import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { isUUID } from 'class-validator';
import { CollectionResponseDto } from '@common/dto/collection-response.dto';
import { ErrorCode } from '@common/enums/error-code.enum';
import { filesConfig } from '@config/files.config';
import type { IStorageService } from '@modules/storage/storage-service.interface';
import {
  ARTWORK_READ_REPOSITORY,
  type ArtworkDetailRecord,
  type IArtworkReadRepository,
} from './repositories/artwork-read-repository.interface';
import { ArtworkResponseDto } from './dto/artwork-response.dto';
import {
  ArtworkDetailResponseDto,
  type SignedArtworkAssets,
} from './dto/artwork-detail-response.dto';

/** Bounded default result cap so the "limited" contract holds from v1 (TOV-199 adds paging). */
const MAX_LIST_RESULTS = 50;
/** Per-signing-call ceiling so a slow Supabase degrades an asset to null instead of hanging the request. */
const SIGN_TIMEOUT_MS = 800;

@Injectable()
export class ArtworksService {
  private readonly logger = new Logger(ArtworksService.name);

  constructor(
    @Inject(ARTWORK_READ_REPOSITORY)
    private readonly repo: IArtworkReadRepository,
    @Inject('IStorageService')
    private readonly storage: IStorageService,
    @Inject(filesConfig.KEY)
    private readonly files: ConfigType<typeof filesConfig>,
  ) {}

  async list(): Promise<CollectionResponseDto<ArtworkResponseDto>> {
    const records = await this.repo.findAll(MAX_LIST_RESULTS);
    // No signing on the list path — primary images are passthrough absolute CDN URLs.
    const data = records.map((record) => ArtworkResponseDto.fromRecord(record));
    return CollectionResponseDto.create(data);
  }

  async findOneById(id: string): Promise<ArtworkDetailResponseDto> {
    // A non-UUID id is treated as a miss → 404 (never 400/500): isUUID rejects any malformed id before it
    // can reach a `WHERE id = $1` uuid column (which would raise Postgres 22P02 → 500). It also rejects
    // absurdly long input, so no separate length guard is needed.
    const record = isUUID(id) ? await this.repo.findOneById(id) : null;
    if (!record) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        message: 'Artwork not found',
        errorCode: ErrorCode.ARTWORK_NOT_FOUND,
      });
    }

    // The DB connection is already released — signing runs entirely in the service layer.
    const signed = await this.signAssets(record);
    return ArtworkDetailResponseDto.build(record, signed);
  }

  /**
   * Sign the supporting images + COA in ONE batched Supabase call (fail-open per asset). Images and COA
   * share a single round-trip; a failed/timed-out asset degrades to omitted (images) / null (COA).
   */
  private async signAssets(record: ArtworkDetailRecord): Promise<SignedArtworkAssets> {
    const imagePaths = record.supportingImages;
    const coaPath = record.coaStoragePath;
    const paths = coaPath ? [...imagePaths, coaPath] : imagePaths;
    if (paths.length === 0) {
      return { supportingImages: [], coaSignedUrl: null };
    }

    const signed = await this.signBatch(paths, record.id);
    const supportingImages = signed.slice(0, imagePaths.length).filter((url): url is string => url !== null);
    const coaSignedUrl = coaPath ? (signed[imagePaths.length] ?? null) : null;
    return { supportingImages, coaSignedUrl };
  }

  /** One batch sign call bounded by a timeout; on failure/timeout every asset degrades to null (fail-open). */
  private async signBatch(paths: string[], artworkId: string): Promise<(string | null)[]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SIGN_TIMEOUT_MS);
      });
      const result = await Promise.race([
        this.storage.createTemporaryUrls(paths, this.files.signedUrlTtl),
        timeout,
      ]);
      if (result === null) {
        // artwork id (not the storage paths) is logged: enough to trace a "missing image" report without
        // leaking internal bucket keys.
        this.logger.warn(
          `Signing timed out after ${SIGN_TIMEOUT_MS}ms for artwork ${artworkId}; omitting ${paths.length} asset(s)`,
        );
        return paths.map(() => null);
      }
      return result;
    } catch (error) {
      this.logger.warn(
        `Failed to sign assets for artwork ${artworkId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return paths.map(() => null);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
