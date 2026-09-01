import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import TimelineEventCard from '@/components/artwork/TimelineEventCard';
import {
  fractionalizationEvent,
  secondaryTradeEvent,
  genericEvent,
} from '@/test/fixtures/timeline';
import type { TimelineEvent } from '@/lib/types/api';

describe('TimelineEventCard', () => {
  it('renders a fractionalization card: label, summary, date, token/ledger/tx rows (truncated)', () => {
    render(<TimelineEventCard event={fractionalizationEvent} />);
    expect(screen.getByText('Fractionalized')).toBeInTheDocument();
    expect(screen.getByText('Artwork fractionalized into 10,000 shares')).toBeInTheDocument();
    expect(screen.getByText('24 Aug 2026')).toBeInTheDocument(); // fixed UTC format
    expect(screen.getByText('1234567')).toBeInTheDocument(); // deploy ledger — plain (not grouped)
    expect(screen.getByText('CB7QF4…000000')).toBeInTheDocument(); // token truncated middle
  });

  it('renders a secondary_trade card: fractions + formatted USDC price (large i128, no float drift), NO txHash', () => {
    render(<TimelineEventCard event={secondaryTradeEvent} />);
    expect(screen.getByText('Secondary trade')).toBeInTheDocument();
    expect(screen.getByText('250')).toBeInTheDocument();
    expect(screen.getByText('12,345,678.9012345 USDC')).toBeInTheDocument(); // exact from "123456789012345"
    expect(screen.queryByText(/txHash|tx hash/i)).not.toBeInTheDocument();
  });

  it('renders an unknown/generic type via the generic card (labelFor fallback, summary, no bespoke rows)', () => {
    const unknown: TimelineEvent = {
      id: '00000000-0000-4000-8000-0000000e0aaa',
      eventType: 'some_future_type',
      visibilityTier: 'default',
      occurredAt: '2026-08-22T12:00:00.000Z',
      summary: 'A future event',
      metadata: {},
    };
    render(<TimelineEventCard event={unknown} />);
    expect(screen.getByText('some future type')).toBeInTheDocument(); // underscores → spaces
    expect(screen.getByText('A future event')).toBeInTheDocument();
    expect(screen.queryByText('Price / fraction')).not.toBeInTheDocument();
    expect(screen.queryByText('Token')).not.toBeInTheDocument();
  });

  it('renders a null summary without a literal "null", and omits the date on an unparseable occurredAt', () => {
    const { container } = render(
      <TimelineEventCard event={{ ...genericEvent, summary: null, occurredAt: 'not-a-date' }} />,
    );
    expect(screen.queryByText('null')).not.toBeInTheDocument();
    expect(container.querySelector('time')).toBeNull(); // no <time> when the date is unparseable
  });

  // Defense-in-depth (todo #202): the service mapper drops a live type with invalid metadata, so this shape
  // shouldn't occur — but the card must never throw even if fed one directly.
  it('does not throw when a secondary_trade is (defensively) fed a missing price — the price row is omitted', () => {
    const bad = {
      ...secondaryTradeEvent,
      metadata: { fractionCount: '250' }, // pricePerFractionStroops missing
    } as unknown as TimelineEvent;
    expect(() => render(<TimelineEventCard event={bad} />)).not.toThrow();
    expect(screen.getByText('250')).toBeInTheDocument();
    expect(screen.queryByText('Price / fraction')).not.toBeInTheDocument();
  });

  it('does not throw when a fractionalization is (defensively) fed a missing tokenAddress', () => {
    const bad = {
      ...fractionalizationEvent,
      metadata: { deployLedger: 1234567 }, // tokenAddress/txHash missing
    } as unknown as TimelineEvent;
    expect(() => render(<TimelineEventCard event={bad} />)).not.toThrow();
  });
});
