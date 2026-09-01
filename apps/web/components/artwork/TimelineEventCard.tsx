import { memo } from 'react';
import type { TimelineEvent } from '@/lib/types/api';
import { formatUsdc, formatCount } from '@/lib/money/format';
import { formatUtcDate } from '@/lib/format/date';
import { MONEY_FIGURE } from '@/components/ui/typography';
import { TONE_CARD_BASE, TONE_NEUTRAL, TONE_ACCENT } from '@/components/ui/surfaces';

// One provenance event. Dispatches on `eventType`: bespoke rows for the two live types, a generic summary card
// for the 7 known-future + any unknown type. Meaning is carried by the type label text (+ an sr-only prefix),
// never colour alone.
//
// `eventType` is an OPEN discriminant (`… | (string & {})`), so an inline `=== 'fractionalization'` can't narrow
// `metadata`. An `Extract` type guard DOES narrow cleanly (the generic arm's `string` discriminant doesn't
// extend a literal), giving typed metadata with zero value casts.
// K is constrained to the two BESPOKE literals (not all KnownEventType): the 7 generic known types have no typed
// arm, so `Extract<…>` would resolve to `never` and calling this for them is a footgun — now a compile error (#209).
function isEventType<K extends 'fractionalization' | 'secondary_trade'>(
  event: TimelineEvent,
  kind: K,
): event is Extract<TimelineEvent, { eventType: K }> {
  return event.eventType === kind;
}

const EVENT_LABELS: Partial<Record<string, string>> = {
  fractionalization: 'Fractionalized',
  secondary_trade: 'Secondary trade',
  artwork_verification: 'Verification',
  exhibition: 'Exhibition',
  loan: 'Loan',
  condition_report: 'Condition report',
  admin_note: 'Admin note',
  technical: 'Technical',
  attestation: 'Attestation',
};

function labelFor(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType.replace(/_/g, ' ');
}

// Defensive: the service mapper already guarantees typed events carry valid metadata (a live type with bad
// metadata is dropped, todo #202), so this can't be reached with a non-string today — but guarding here means a
// future regression can never throw `undefined.length` in render.
function truncateMiddle(value: unknown): string {
  if (typeof value !== 'string') return '';
  if (value.length <= 13) return value; // 6 + 6 + the ellipsis
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

// formatUsdc throws on a non-decimal string (fail-closed, by design in lib/money). On this fail-open render
// surface we guard first and fall back to null so a bad value degrades the row rather than crashing the card.
function safeUsdc(value: unknown): string | null {
  return typeof value === 'string' && /^\d+$/.test(value) ? `${formatUsdc(value)} USDC` : null;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-flint">{label}</dt>
      <dd className={`${MONEY_FIGURE} text-right break-all`}>{value}</dd>
    </div>
  );
}

// Memoized (#212): appended pages preserve prior element references, so already-rendered cards skip re-render on
// every state transition (isPending/announce/append) — only the new cards render, avoiding re-running the Intl
// formatters across the whole list.
function TimelineEventCard({ event }: { event: TimelineEvent }) {
  const date = formatUtcDate(event.occurredAt);
  // fractionalization reads as a milestone → warm accent; everything else stays neutral.
  const tone = event.eventType === 'fractionalization' ? TONE_ACCENT : TONE_NEUTRAL;

  let details: React.ReactNode = null;
  if (isEventType(event, 'fractionalization')) {
    const meta = event.metadata; // FractionalizationMeta
    details = (
      <dl className="mt-3 flex flex-col gap-1 border-t border-charcoal/10 pt-3">
        <DetailRow label="Token" value={truncateMiddle(meta.tokenAddress)} />
        {/* A ledger SEQUENCE number is an identifier, not a grouped quantity — render it plain (#215). */}
        <DetailRow label="Deploy ledger" value={String(meta.deployLedger)} />
        <DetailRow label="Deploy tx" value={truncateMiddle(meta.txHash)} />
      </dl>
    );
  } else if (isEventType(event, 'secondary_trade')) {
    const meta = event.metadata; // SecondaryTradeMeta
    const price = safeUsdc(meta.pricePerFractionStroops);
    details = (
      <dl className="mt-3 flex flex-col gap-1 border-t border-charcoal/10 pt-3">
        <DetailRow label="Fractions" value={formatCount(meta.fractionCount)} />
        {price ? <DetailRow label="Price / fraction" value={price} /> : null}
      </dl>
    );
  }

  return (
    <li
      tabIndex={-1}
      // Programmatically focused after a manual load-more (#208) — show a visible ring so a keyboard user can
      // see where they landed (was `outline-none`, an invisible focus target).
      className={`${TONE_CARD_BASE} ${tone} flex-col focus:outline-2 focus:outline-offset-2 focus:outline-ochre`}
    >
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-heading text-sm font-medium text-umber">
          <span className="sr-only">Event type: </span>
          {labelFor(event.eventType)}
        </span>
        {date ? (
          <time dateTime={event.occurredAt} className="shrink-0 text-xs text-flint">
            {date}
          </time>
        ) : null}
      </div>
      {event.summary ? <p className="mt-1 text-sm text-charcoal">{event.summary}</p> : null}
      {details}
    </li>
  );
}

export default memo(TimelineEventCard);
