/**
 * Shared artwork-timeline-event seeder for integration + e2e suites (TOV-191). Centralizes the raw
 * `INSERT INTO artwork_timeline_events` column list. `visibility_tier` is DB-generated (never inserted).
 * Seed the parent artwork first (FK `artwork_id → artworks`).
 */
export type QueryFn = (text: string, params?: unknown[]) => Promise<unknown[]>;

export interface SeedTimelineEventOpts {
  artworkId: string;
  eventType?: string;
  isPublished?: boolean;
  /** Business event time. Pass an ISO string or Date; defaults to now(). */
  occurredAt?: string | Date;
  summary?: string | null;
  eventData?: Record<string, unknown>;
  sourceRef?: string | null;
}

export async function insertTimelineEvent(q: QueryFn, opts: SeedTimelineEventOpts): Promise<void> {
  const occurredAt =
    opts.occurredAt instanceof Date ? opts.occurredAt.toISOString() : (opts.occurredAt ?? new Date().toISOString());
  await q(
    `INSERT INTO "artwork_timeline_events"
       ("artwork_id", "event_type", "is_published", "occurred_at", "summary", "event_data", "source_ref")
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      opts.artworkId,
      opts.eventType ?? 'fractionalization',
      opts.isPublished ?? true,
      occurredAt,
      opts.summary ?? null,
      JSON.stringify(opts.eventData ?? {}),
      opts.sourceRef ?? null,
    ],
  );
}
