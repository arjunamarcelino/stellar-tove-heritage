import { Column, Entity } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { DEFAULT_TIER_EVENT_TYPES } from '../constants/timeline-event.constant';
import type { TimelineEventType, VisibilityTier } from '../constants/timeline-event.constant';

/**
 * Mirror of the migration's generated-column CASE, DERIVED from the single-source `DEFAULT_TIER_EVENT_TYPES`
 * (review #404) so this inert mirror cannot become a third hand-maintained copy that silently drifts from
 * the confidentiality boundary. The migration remains authoritative for the actual DB column.
 */
const DEFAULT_TIER_SQL_LIST = DEFAULT_TIER_EVENT_TYPES.map((t) => `'${t}'`).join(',');

/**
 * One public timeline event for an artwork (TOV-191). Under `synchronize:false` the migration
 * (`1716000000047`) is authoritative for the CHECK belt, the generated `visibility_tier` column, the two
 * partial indexes, the FULL-unique `source_ref` idempotency belt, and the freeze-list guard trigger. This
 * entity mirrors the shape (and registers the table for `autoLoadEntities` + test truncation). The read/emit
 * paths use raw parameterized SQL over the `DataSource`, so this entity is not queried through directly.
 */
@Entity({ name: 'artwork_timeline_events' })
export class ArtworkTimelineEvent extends BaseEntity {
  @Column({ name: 'artwork_id', type: 'uuid' })
  artworkId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 32 })
  eventType!: TimelineEventType;

  /**
   * DB-GENERATED (STORED) from `event_type` — fail-closed (`ELSE 'expanded'`). Read-only: never written by
   * the app (the confidentiality boundary cannot be drifted by a writer).
   */
  @Column({
    name: 'visibility_tier',
    type: 'varchar',
    length: 16,
    generatedType: 'STORED',
    asExpression: `CASE WHEN "event_type" IN (${DEFAULT_TIER_SQL_LIST}) THEN 'default' ELSE 'expanded' END`,
    insert: false,
    update: false,
    select: true,
  })
  visibilityTier!: VisibilityTier;

  /** Opt-in publish (DB DEFAULT false). Default-tier emitters insert `true` explicitly; expanded-tier
   * (admin_note/technical/attestation) writers must set `true` to surface a row on `?expand=true`. */
  @Column({ name: 'is_published', type: 'boolean', default: false })
  isPublished!: boolean;

  /** The business event time (ms precision → lossless keyset cursor round-trip). */
  @Column({ name: 'occurred_at', type: 'timestamptz', precision: 3 })
  occurredAt!: Date;

  @Column({ name: 'summary', type: 'text', nullable: true })
  summary!: string | null;

  /** Public-safe, per-event-type allowlisted payload (never user subs / PII). */
  @Column({ name: 'event_data', type: 'jsonb', default: () => `'{}'` })
  eventData!: Record<string, unknown>;

  /** Idempotency key for auto-emitted events (e.g. `secondary_trade:{tradeId}`); NULL for manual events. */
  @Column({ name: 'source_ref', type: 'varchar', length: 128, nullable: true })
  sourceRef!: string | null;
}
