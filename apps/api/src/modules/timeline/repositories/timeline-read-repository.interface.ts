import type { TimelineEventType, VisibilityTier } from '../constants/timeline-event.constant';
import type { CursorPosition } from '../timeline-cursor';

/**
 * Read projection of a timeline event (TOV-191). Raw jsonb `eventData` is passed to the DTO, which applies a
 * per-event-type key allowlist at serialization — a defense-in-depth belt on top of the write-side allowlist.
 */
export interface TimelineEventRecord {
  readonly id: string;
  readonly eventType: TimelineEventType;
  readonly visibilityTier: VisibilityTier;
  readonly occurredAt: Date;
  readonly summary: string | null;
  readonly eventData: Record<string, unknown>;
}

export interface TimelinePageArgs {
  artworkId: string;
  expand: boolean;
  limit: number;
  cursor?: CursorPosition;
}

export interface TimelinePage {
  readonly events: readonly TimelineEventRecord[];
  /** True when more rows exist beyond this page (computed via a `limit + 1` lookahead). */
  readonly hasMore: boolean;
}

/** DI token for the timeline read-model repository (string-token style, matches ARTWORK_READ_REPOSITORY). */
export const TIMELINE_READ_REPOSITORY = 'ITimelineReadRepository';

/**
 * Read-only seam over the timeline. The impl COMPOSES a `DataSource` (raw keyset SQL — TypeORM has no native
 * row-value operator) rather than extending `BaseRepository`.
 */
export interface ITimelineReadRepository {
  /** Visibility gate: the artwork exists, is not soft-deleted, and is anonymously visible. */
  existsVisibleArtwork(id: string): Promise<boolean>;
  /** One keyset page (newest-first). `expand=false` restricts to the default tier. Published events only. */
  page(args: TimelinePageArgs): Promise<TimelinePage>;
  /** Whole-artwork total of PUBLISHED expanded-tier events (page-independent). */
  countExpanded(artworkId: string): Promise<number>;
}
