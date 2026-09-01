import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { ErrorCode } from '@common/enums/error-code.enum';
import {
  TIMELINE_READ_REPOSITORY,
  type ITimelineReadRepository,
} from './repositories/timeline-read-repository.interface';
import { decodeCursor, encodeCursor } from './timeline-cursor';
import { TimelineResponseDto } from './dto/timeline-response.dto';
import type { TimelineQueryDto } from './dto/timeline-query.dto';

@Injectable()
export class TimelineService {
  constructor(
    @Inject(TIMELINE_READ_REPOSITORY)
    private readonly repo: ITimelineReadRepository,
  ) {}

  async getTimeline(id: string, query: TimelineQueryDto): Promise<TimelineResponseDto> {
    // 404 precedence FIRST (before any cursor parse), and the UUID guard short-circuits BEFORE the DB read so
    // a non-UUID never reaches a uuid column (Postgres 22P02 → 500). A hidden/soft-deleted/non-visible artwork
    // returns the identical 404 (no existence oracle) — so a bad cursor on a hidden artwork still 404s.
    if (!isUUID(id) || !(await this.repo.existsVisibleArtwork(id))) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        message: 'Artwork not found',
        errorCode: ErrorCode.ARTWORK_NOT_FOUND,
      });
    }

    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const page = await this.repo.page({
      artworkId: id,
      expand: query.expand,
      limit: query.limit,
      cursor,
    });

    // additionalEventsCount is a whole-artwork, page-independent hint — compute it ONLY on the first page
    // (no cursor) and return 0 on paginated pages, so a deep scroll doesn't recompute a constant count on
    // every request. The FE reads the count from the first page. (review #403)
    const additionalEventsCount =
      query.expand || query.cursor ? 0 : await this.repo.countExpanded(id);

    const last = page.events[page.events.length - 1];
    const nextCursor =
      page.hasMore && last ? encodeCursor({ occurredAtMs: last.occurredAt.getTime(), id: last.id }) : null;

    return TimelineResponseDto.build(page.events, additionalEventsCount, nextCursor);
  }
}
