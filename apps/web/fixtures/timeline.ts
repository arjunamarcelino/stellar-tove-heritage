// Shared fixtures for the public artwork provenance timeline (TOV-192 / FR-08.02+08.03). Wire shapes are what
// the backend (TOV-191) returns (camelCase); the mapped `*Event` objects are the domain shape the service
// emits. Only the two live types + one representative generic/unknown type are fixtured — the 7 known-future
// types share the single generic branch, so one unknown suffices. Downstream tests add LOCAL fixtures.

import type { TimelineEvent, Stroops, PositiveIntString } from '@/lib/types/api';

export const TIMELINE_ARTWORK_ID = '00000000-0000-4000-8000-0000000a0001';
export const NEXT_CURSOR = 'eyJ2IjoxLCJvIjoiMjAyNi0wOC0yMCJ9'; // opaque; treated verbatim

const FRACTIONALIZATION_ID = '00000000-0000-4000-8000-0000000e0001';
const SECONDARY_TRADE_ID = '00000000-0000-4000-8000-0000000e0002';
const GENERIC_ID = '00000000-0000-4000-8000-0000000e0003';
const EXPANDED_ID = '00000000-0000-4000-8000-0000000e0004';
const ABSENT_SUMMARY_ID = '00000000-0000-4000-8000-0000000e0005';

// ── Wire events (camelCase) ─────────────────────────────────────────────────────────────────────────
export const fractionalizationWire = {
  id: FRACTIONALIZATION_ID,
  eventType: 'fractionalization',
  visibilityTier: 'default',
  occurredAt: '2026-08-24T10:00:00.000Z',
  summary: 'Artwork fractionalized into 10,000 shares',
  metadata: {
    tokenAddress: 'CB7QF4EXAMPLETOKENADDRESS000000000000000000000000000000000',
    deployLedger: 1234567,
    txHash: 'a1b2c3d4e5f600000000000000000000000000000000000000000000000000',
  },
} as const;

// Large i128 price to prove BigInt display (no JS-number float drift). fractionCount is a plain count string.
export const secondaryTradeWire = {
  id: SECONDARY_TRADE_ID,
  eventType: 'secondary_trade',
  visibilityTier: 'default',
  occurredAt: '2026-08-23T09:30:00.000Z',
  summary: '250 fractions traded',
  metadata: {
    fractionCount: '250',
    pricePerFractionStroops: '123456789012345', // 12,345,678.9012345 USDC — no float drift allowed
    settledAt: '2026-08-23T09:31:00.000Z',
    // deliberately NO txHash (locked payload decision)
  },
} as const;

// A schema-only (future) type — renders via the generic card.
export const genericWire = {
  id: GENERIC_ID,
  eventType: 'exhibition',
  visibilityTier: 'default',
  occurredAt: '2026-08-22T12:00:00.000Z',
  summary: 'Exhibited at the Oslo Contemporary',
  metadata: {},
} as const;

// An expanded-tier (admin/technical) event — only appears with ?expand=true.
export const expandedWire = {
  id: EXPANDED_ID,
  eventType: 'technical',
  visibilityTier: 'expanded',
  occurredAt: '2026-08-21T08:00:00.000Z',
  summary: 'Metadata schema migrated',
  metadata: {},
} as const;

// summary KEY absent — under the fail-open rule the event survives with summary: null (Open Q6).
export const absentSummaryWire = {
  id: ABSENT_SUMMARY_ID,
  eventType: 'admin_note',
  visibilityTier: 'expanded',
  occurredAt: '2026-08-20T07:00:00.000Z',
  metadata: {},
} as const;

// Missing the required `id` → drops (fail-open per item, drives droppedCount).
export const malformedEventWire = {
  eventType: 'secondary_trade',
  visibilityTier: 'default',
  occurredAt: '2026-08-19T06:00:00.000Z',
  summary: 'no id here',
  metadata: {},
} as const;

// ── Wire envelopes ──────────────────────────────────────────────────────────────────────────────────
export const timelinePage1Wire = {
  events: [fractionalizationWire, secondaryTradeWire],
  additionalEventsCount: 3, // published expanded events exist for the whole artwork
  nextCursor: NEXT_CURSOR,
} as const;

export const timelinePage2Wire = {
  events: [genericWire],
  additionalEventsCount: 3,
  nextCursor: null, // last page
} as const;

export const expandedPageWire = {
  events: [fractionalizationWire, expandedWire], // mixed tier, chronologically interleaved
  additionalEventsCount: 0, // everything is inline when expanded
  nextCursor: null,
} as const;

export const emptyPageWire = {
  events: [],
  additionalEventsCount: 0,
  nextCursor: null,
} as const;

export const droppedPageWire = {
  events: [fractionalizationWire, malformedEventWire],
  additionalEventsCount: 0,
  nextCursor: null,
} as const;

// Structurally-broken envelope (events not an array) → SERVER_ERROR (fail-closed), NOT "0 events".
export const malformedEnvelopeWire = {
  events: 'not-an-array',
  additionalEventsCount: 0,
  nextCursor: null,
} as const;

// ── Mapped domain events (what the service emits) ─────────────────────────────────────────────────────
export const fractionalizationEvent: TimelineEvent = {
  id: FRACTIONALIZATION_ID,
  eventType: 'fractionalization',
  visibilityTier: 'default',
  occurredAt: '2026-08-24T10:00:00.000Z',
  summary: 'Artwork fractionalized into 10,000 shares',
  metadata: {
    tokenAddress: 'CB7QF4EXAMPLETOKENADDRESS000000000000000000000000000000000',
    deployLedger: 1234567,
    txHash: 'a1b2c3d4e5f600000000000000000000000000000000000000000000000000',
  },
};

export const secondaryTradeEvent: TimelineEvent = {
  id: SECONDARY_TRADE_ID,
  eventType: 'secondary_trade',
  visibilityTier: 'default',
  occurredAt: '2026-08-23T09:30:00.000Z',
  summary: '250 fractions traded',
  metadata: {
    fractionCount: '250' as PositiveIntString,
    pricePerFractionStroops: '123456789012345' as Stroops,
    settledAt: '2026-08-23T09:31:00.000Z',
  },
};

// Mapped generic event (schema-only type → generic arm, raw metadata passed through).
export const genericEvent: TimelineEvent = {
  id: GENERIC_ID,
  eventType: 'exhibition',
  visibilityTier: 'default',
  occurredAt: '2026-08-22T12:00:00.000Z',
  summary: 'Exhibited at the Oslo Contemporary',
  metadata: {},
};
