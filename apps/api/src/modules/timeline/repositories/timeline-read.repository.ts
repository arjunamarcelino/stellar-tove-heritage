import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PUBLIC_VISIBLE_STATUSES } from '@modules/artworks/constants/artwork-visibility.constant';
import { assertKnownEventType, assertVisibilityTier } from '../constants/timeline-event.constant';
import type {
  ITimelineReadRepository,
  TimelineEventRecord,
  TimelinePage,
  TimelinePageArgs,
} from './timeline-read-repository.interface';

/** Raw DB row shape (snake_case, as Postgres returns it). `event_data` (jsonb) is parsed to an object by pg. */
interface TimelineEventRow {
  readonly id: string;
  readonly event_type: string;
  readonly visibility_tier: string;
  readonly occurred_at: Date;
  readonly summary: string | null;
  readonly event_data: unknown;
}

/**
 * TypeORM-backed public timeline read model (TOV-191). COMPOSES the `DataSource` (raw parameterized SQL) —
 * the `(occurred_at, id) < (…)` row-value keyset predicate is not expressible via TypeORM find-options, and
 * a projection-returning seam is incompatible with `BaseRepository`. READ-ONLY by contract.
 */
@Injectable()
export class TimelineReadRepository implements ITimelineReadRepository {
  constructor(private readonly dataSource: DataSource) {}

  async existsVisibleArtwork(id: string): Promise<boolean> {
    const rows = await this.dataSource.query<unknown[]>(
      `SELECT 1 FROM "artworks"
       WHERE "id" = $1 AND "status" = ANY($2) AND "deleted_at" IS NULL
       LIMIT 1`,
      [id, [...PUBLIC_VISIBLE_STATUSES]],
    );
    return rows.length > 0;
  }

  async page(args: TimelinePageArgs): Promise<TimelinePage> {
    const params: unknown[] = [args.artworkId];
    let sql =
      `SELECT "id", "event_type", "visibility_tier", "occurred_at", "summary", "event_data"
       FROM "artwork_timeline_events"
       WHERE "artwork_id" = $1 AND "deleted_at" IS NULL AND "is_published" = true`;

    if (!args.expand) {
      sql += ` AND "visibility_tier" = 'default'`;
    }

    if (args.cursor) {
      // Bind the cursor's occurred_at as an exact-ms ISO string cast to timestamptz(3) — lossless, no float.
      params.push(new Date(args.cursor.occurredAtMs).toISOString());
      const occIdx = params.length;
      params.push(args.cursor.id);
      const idIdx = params.length;
      // Row-value tuple → single index range seek (both columns DESC, same direction).
      sql += ` AND ("occurred_at", "id") < ($${occIdx}::timestamptz, $${idIdx})`;
    }

    params.push(args.limit + 1); // +1 lookahead to detect a further page
    const limitIdx = params.length;
    sql += ` ORDER BY "occurred_at" DESC, "id" DESC LIMIT $${limitIdx}`;

    const rows = await this.dataSource.query<TimelineEventRow[]>(sql, params);
    const hasMore = rows.length > args.limit;
    const events = (hasMore ? rows.slice(0, args.limit) : rows).map((row) => this.toRecord(row));
    return { events, hasMore };
  }

  async countExpanded(artworkId: string): Promise<number> {
    const rows = await this.dataSource.query<Array<{ count: number }>>(
      `SELECT count(*)::int AS "count" FROM "artwork_timeline_events"
       WHERE "artwork_id" = $1 AND "deleted_at" IS NULL AND "is_published" = true
         AND "visibility_tier" = 'expanded'`,
      [artworkId],
    );
    return rows[0]?.count ?? 0;
  }

  /** Raw row → projection, field-by-field; enum columns pass the drift guards. */
  private toRecord(row: TimelineEventRow): TimelineEventRecord {
    return {
      id: row.id,
      eventType: assertKnownEventType(row.event_type),
      visibilityTier: assertVisibilityTier(row.visibility_tier),
      occurredAt: row.occurred_at,
      summary: row.summary,
      eventData: (row.event_data ?? {}) as Record<string, unknown>,
    };
  }
}
