/**
 * Timeline event vocabulary (TOV-191, FR-08.02/08.03). Single source of truth for the runtime tuple AND the
 * derived `TimelineEventType` union. `DEFAULT_TIER_EVENT_TYPES` MUST stay identical to the fail-closed CASE in
 * migration `1716000000047` — a drift test (`assertVisibilityTier` over both tiers) enforces it.
 *
 * The migration's DB CHECK is authoritative for what can be inserted; these constants type the read boundary
 * and let `assertKnownEventType` fail LOUD if a drifted DB value ever escapes the CHECK.
 */
export const TIMELINE_EVENT_TYPES = [
  'artwork_verification',
  'fractionalization',
  'exhibition',
  'loan',
  'condition_report',
  'secondary_trade',
  'admin_note',
  'technical',
  'attestation',
] as const;

export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

/** The default-visible tier — mirrors the migration's generated-column allowlist EXACTLY (drift-guarded). */
export const DEFAULT_TIER_EVENT_TYPES = [
  'artwork_verification',
  'fractionalization',
  'exhibition',
  'loan',
  'condition_report',
  'secondary_trade',
] as const satisfies readonly TimelineEventType[];

export const VISIBILITY_TIERS = ['default', 'expanded'] as const;
export type VisibilityTier = (typeof VISIBILITY_TIERS)[number];

/** Narrow a DB `event_type` string flowing out of the read repo; fails LOUD (→ 500) only on schema drift. */
export function assertKnownEventType(value: string): TimelineEventType {
  if ((TIMELINE_EVENT_TYPES as readonly string[]).includes(value)) {
    return value as TimelineEventType;
  }
  throw new Error(`Unexpected timeline event_type escaped the CHECK constraint: ${value}`);
}

/** Narrow a DB `visibility_tier` string; fails LOUD only on schema drift (the generated column guarantees it). */
export function assertVisibilityTier(value: string): VisibilityTier {
  if ((VISIBILITY_TIERS as readonly string[]).includes(value)) {
    return value as VisibilityTier;
  }
  throw new Error(`Unexpected timeline visibility_tier escaped the generated column: ${value}`);
}

/** The tier a given event_type resolves to — mirrors the DB generated column (used by the drift test). */
export function tierForEventType(eventType: TimelineEventType): VisibilityTier {
  return (DEFAULT_TIER_EVENT_TYPES as readonly TimelineEventType[]).includes(eventType) ? 'default' : 'expanded';
}
