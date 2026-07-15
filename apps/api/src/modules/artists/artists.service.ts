import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { CollectionResponseDto } from '@common/dto/collection-response.dto';
import { ErrorCode } from '@common/enums/error-code.enum';
import {
  ARTIST_READ_REPOSITORY,
  type IArtistReadRepository,
} from './repositories/artist-read-repository.interface';
import { ArtistResponseDto } from './dto/artist-response.dto';

/** Bounded default result cap so the "limited" contract holds before pagination (TOV-199). */
const MAX_LIST_RESULTS = 50;

/** URL-safe handle charset; anything else is treated as "not found" (never 400/500). */
const HANDLE_REGEX = /^[a-z0-9-]{1,64}$/;

@Injectable()
export class ArtistsService {
  constructor(
    @Inject(ARTIST_READ_REPOSITORY)
    private readonly repo: IArtistReadRepository,
  ) {}

  async list(): Promise<CollectionResponseDto<ArtistResponseDto>> {
    const records = await this.repo.findAll(MAX_LIST_RESULTS);
    const data = records.map((record) => ArtistResponseDto.fromRecord(record));
    return CollectionResponseDto.create(data);
  }

  async findByHandle(handle: string): Promise<ArtistResponseDto> {
    const record = HANDLE_REGEX.test(handle) ? await this.repo.findByHandle(handle) : null;
    if (!record) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        message: 'Artist not found',
        errorCode: ErrorCode.ARTIST_NOT_FOUND,
      });
    }
    return ArtistResponseDto.fromRecord(record);
  }
}
