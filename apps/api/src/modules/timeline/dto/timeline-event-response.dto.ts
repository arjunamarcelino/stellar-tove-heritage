import { ApiProperty } from '@nestjs/swagger';
import {
  TIMELINE_EVENT_TYPES,
  VISIBILITY_TIERS,
  type TimelineEventType,
  type VisibilityTier,
} from '../constants/timeline-event.constant';
import type { TimelineEventRecord } from '../repositories/timeline-read-repository.interface';
import type { FractionalizationEventData, SecondaryTradeEventData } from '../types/timeline-event-data';

// Allowlist keys tied to `keyof` the payload types (review #404): a rename/removal on a payload interface is
// now a compile break, and `secondary_trade` physically cannot list `txHash` (not a key of its payload type).
const FRACTIONALIZATION_KEYS = ['tokenAddress', 'deployLedger', 'txHash'] as const satisfies readonly (keyof FractionalizationEventData)[];
const SECONDARY_TRADE_KEYS = ['fractionCount', 'pricePerFractionStroops', 'settledAt'] as const satisfies readonly (keyof SecondaryTradeEventData)[];

/**
 * Read-side per-event-type key allowlist (defense-in-depth on top of the write-side typed payloads). Only
 * these keys can ever reach an anonymous client, so a mis-populated `event_data` row can't leak PII even if a
 * future writer regresses. Types with no writer map to `[]` (nothing surfaces).
 *
 * NB: `secondary_trade` excludes `txHash` (counterparty deanonymization — resolved Open Q1).
 */
const METADATA_ALLOWLIST: Record<TimelineEventType, readonly string[]> = {
  fractionalization: FRACTIONALIZATION_KEYS,
  secondary_trade: SECONDARY_TRADE_KEYS,
  artwork_verification: [],
  exhibition: [],
  loan: [],
  condition_report: [],
  admin_note: [],
  technical: [],
  attestation: [],
};

function projectMetadata(
  eventType: TimelineEventType,
  eventData: Record<string, unknown>,
): Record<string, unknown> {
  const allow = METADATA_ALLOWLIST[eventType];
  const out: Record<string, unknown> = {};
  for (const key of allow) {
    const v = eventData[key];
    if (v !== undefined && v !== null) out[key] = v;
  }
  return out;
}

export class TimelineEventResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: TIMELINE_EVENT_TYPES })
  eventType!: TimelineEventType;

  @ApiProperty({ enum: VISIBILITY_TIERS })
  visibilityTier!: VisibilityTier;

  @ApiProperty({ type: String, format: 'date-time' })
  occurredAt!: string;

  @ApiProperty({ type: String, nullable: true })
  summary!: string | null;

  @ApiProperty({ type: Object, description: 'Public-safe, per-event-type payload' })
  metadata!: Record<string, unknown>;

  /** Field-by-field (never spread the record); metadata is key-allowlisted so PII cannot leak. */
  static from(record: TimelineEventRecord): TimelineEventResponseDto {
    const dto = new TimelineEventResponseDto();
    dto.id = record.id;
    dto.eventType = record.eventType;
    dto.visibilityTier = record.visibilityTier;
    dto.occurredAt = record.occurredAt.toISOString();
    dto.summary = record.summary;
    dto.metadata = projectMetadata(record.eventType, record.eventData);
    return dto;
  }
}
