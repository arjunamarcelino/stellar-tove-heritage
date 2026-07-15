import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { CollectionResponseDto } from '@common/dto/collection-response.dto';
import { ErrorCode } from '@common/enums/error-code.enum';
import {
  ARTWORK_READ_REPOSITORY,
  type IArtworkReadRepository,
} from './repositories/artwork-read-repository.interface';
import { ArtworkResponseDto } from './dto/artwork-response.dto';

/** Bounded default result cap so the "limited" contract holds from v1 (TOV-199 adds paging). */
const MAX_LIST_RESULTS = 50;
// Artwork ids are opaque (future UUIDv7, TOV-75), so — unlike the artist `:handle`
// slug — there is no charset constraint; only an upper length bound is enforced.
// Any unknown/malformed id simply misses the lookup → 404 (never 400/500).
const MAX_ID_LENGTH = 128;

@Injectable()
export class ArtworksService {
  constructor(
    @Inject(ARTWORK_READ_REPOSITORY)
    private readonly repo: IArtworkReadRepository,
  ) {}

  async list(): Promise<CollectionResponseDto<ArtworkResponseDto>> {
    const records = await this.repo.findAll(MAX_LIST_RESULTS);
    const data = records.map((record) => ArtworkResponseDto.fromRecord(record));
    return CollectionResponseDto.create(data);
  }

  async findOneById(id: string): Promise<ArtworkResponseDto> {
    const record = id.length > MAX_ID_LENGTH ? null : await this.repo.findOneById(id);
    if (!record) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        message: 'Artwork not found',
        errorCode: ErrorCode.ARTWORK_NOT_FOUND,
      });
    }
    return ArtworkResponseDto.fromRecord(record);
  }
}
