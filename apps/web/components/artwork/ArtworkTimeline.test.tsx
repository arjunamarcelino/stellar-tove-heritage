import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ loadTimelinePageAction: vi.fn() }));
vi.mock('@/app/actions/timeline', () => ({ loadTimelinePageAction: h.loadTimelinePageAction }));

import ArtworkTimeline from '@/components/artwork/ArtworkTimeline';
import {
  TIMELINE_ARTWORK_ID,
  NEXT_CURSOR,
  fractionalizationEvent,
  secondaryTradeEvent,
  genericEvent,
} from '@/test/fixtures/timeline';
import type { TimelineEvent, TimelineResult } from '@/lib/types/api';

// ── Controllable IntersectionObserver mock (jsdom has none) ──
const ioInstances: MockIO[] = [];
class MockIO {
  cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    ioInstances.push(this);
  }
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  trigger(isIntersecting = true) {
    this.cb(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const expandedEvent: TimelineEvent = {
  id: '00000000-0000-4000-8000-0000000e0099',
  eventType: 'technical',
  visibilityTier: 'expanded',
  occurredAt: '2026-08-21T08:00:00.000Z',
  summary: 'Metadata schema migrated',
  metadata: {},
};

const page1: TimelineResult = {
  status: 'success',
  events: [fractionalizationEvent, secondaryTradeEvent],
  nextCursor: NEXT_CURSOR,
  additionalEventsCount: 3,
  droppedCount: 0,
};

function renderTimeline(initial: TimelineResult) {
  return render(<ArtworkTimeline artworkId={TIMELINE_ARTWORK_ID} initial={initial} />);
}

beforeEach(() => {
  h.loadTimelinePageAction.mockReset(); // reset impl + once-queue (clearAllMocks leaves those intact)
  ioInstances.length = 0;
  vi.stubGlobal('IntersectionObserver', MockIO);
});
afterEach(() => vi.unstubAllGlobals());

describe('ArtworkTimeline', () => {
  it('T24: renders the SSR initial default events', () => {
    renderTimeline(page1);
    expect(screen.getByText('Artwork fractionalized into 10,000 shares')).toBeInTheDocument();
    expect(screen.getByText('250 fractions traded')).toBeInTheDocument();
  });

  it('T39: renders type-specific rows — fractionalization ledger + secondary_trade price (no float drift)', () => {
    renderTimeline(page1);
    expect(screen.getByText('1234567')).toBeInTheDocument(); // deploy ledger — plain (not grouped)
    expect(screen.getByText('250')).toBeInTheDocument(); // fraction count
    expect(screen.getByText('12,345,678.9012345 USDC')).toBeInTheDocument(); // exact i128 → display
  });

  it('T25: shows "Show 3 more events" when additionalEventsCount > 0; absent when 0', () => {
    renderTimeline(page1);
    expect(screen.getByRole('button', { name: 'Show 3 more events' })).toBeInTheDocument();

    cleanup(); // fresh mount — the reducer seeds from `initial` only once, by design
    renderTimeline({ ...page1, additionalEventsCount: 0, nextCursor: null });
    expect(screen.queryByRole('button', { name: /Show .* more events/ })).not.toBeInTheDocument();
  });

  it('T26/T27: expand replaces the list with mixed-tier events and flips the toggle; collapse restores', async () => {
    const user = userEvent.setup();
    h.loadTimelinePageAction.mockImplementation(async ({ expand }: { expand: boolean }) =>
      expand
        ? {
            status: 'success',
            events: [fractionalizationEvent, expandedEvent],
            nextCursor: null,
            additionalEventsCount: 0,
            droppedCount: 0,
          }
        : { ...page1 },
    );
    renderTimeline(page1);

    await user.click(screen.getByRole('button', { name: 'Show 3 more events' }));
    expect(await screen.findByText('Metadata schema migrated')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Show fewer' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(h.loadTimelinePageAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ expand: true, cursor: undefined }),
    );

    await user.click(toggle);
    await waitFor(() =>
      expect(screen.queryByText('Metadata schema migrated')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Show 3 more events' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('T28: Load more appends the next page and disappears when nextCursor is null', async () => {
    const user = userEvent.setup();
    h.loadTimelinePageAction.mockResolvedValue({
      status: 'success',
      events: [genericEvent],
      nextCursor: null,
      additionalEventsCount: 3,
      droppedCount: 0,
    });
    renderTimeline(page1);

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Exhibited at the Oslo Contemporary')).toBeInTheDocument();
    expect(h.loadTimelinePageAction).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: NEXT_CURSOR, expand: false }),
    );
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('T29: rapid double-activation of Load more fires the action once (single-flight)', async () => {
    const user = userEvent.setup();
    const d = deferred<TimelineResult>();
    h.loadTimelinePageAction.mockReturnValue(d.promise);
    renderTimeline(page1);

    const btn = screen.getByRole('button', { name: 'Load more' });
    await user.click(btn);
    await user.click(btn); // second click while in flight — must be ignored
    expect(h.loadTimelinePageAction).toHaveBeenCalledTimes(1);
    d.resolve({
      status: 'success',
      events: [genericEvent],
      nextCursor: null,
      additionalEventsCount: 3,
      droppedCount: 0,
    });
    await screen.findByText('Exhibited at the Oslo Contemporary');
  });

  it('T30: a toggle is ignored while an append is in flight (mutual single-flight)', async () => {
    const user = userEvent.setup();
    const d = deferred<TimelineResult>();
    h.loadTimelinePageAction.mockReturnValueOnce(d.promise);
    renderTimeline(page1);

    await user.click(screen.getByRole('button', { name: 'Load more' })); // append in flight
    await user.click(screen.getByRole('button', { name: 'Show 3 more events' })); // toggle — must be ignored
    expect(h.loadTimelinePageAction).toHaveBeenCalledTimes(1);
    expect(h.loadTimelinePageAction).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: NEXT_CURSOR }),
    );
    d.resolve({
      status: 'success',
      events: [genericEvent],
      nextCursor: null,
      additionalEventsCount: 3,
      droppedCount: 0,
    });
    await screen.findByText('Exhibited at the Oslo Contemporary');
  });

  it('T31: an IntersectionObserver intersection triggers the same append path', async () => {
    h.loadTimelinePageAction.mockResolvedValue({
      status: 'success',
      events: [genericEvent],
      nextCursor: null,
      additionalEventsCount: 3,
      droppedCount: 0,
    });
    renderTimeline(page1);
    ioInstances.at(-1)!.trigger(true);
    expect(await screen.findByText('Exhibited at the Oslo Contemporary')).toBeInTheDocument();
  });

  it('T31b: after an append commits, a second observer fire uses the NEXT cursor (fresh closure), not the just-loaded one (#203)', async () => {
    h.loadTimelinePageAction
      .mockResolvedValueOnce({
        status: 'success',
        events: [genericEvent],
        nextCursor: 'CURSOR-2',
        additionalEventsCount: 3,
        droppedCount: 0,
      })
      .mockResolvedValueOnce({
        status: 'success',
        events: [],
        nextCursor: null,
        additionalEventsCount: 3,
        droppedCount: 0,
      });
    renderTimeline(page1);

    ioInstances.at(-1)!.trigger(true); // first auto-load → uses NEXT_CURSOR
    await screen.findByText('Exhibited at the Oslo Contemporary');
    expect(h.loadTimelinePageAction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ cursor: NEXT_CURSOR }),
    );

    ioInstances.at(-1)!.trigger(true); // second auto-load must read the committed cursor, not the stale one
    await waitFor(() => expect(h.loadTimelinePageAction).toHaveBeenCalledTimes(2));
    expect(h.loadTimelinePageAction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: 'CURSOR-2' }),
    );
    // no duplicate render of the appended event
    expect(screen.getAllByText('Exhibited at the Oslo Contemporary')).toHaveLength(1);
  });

  it('T32: a page-2 error keeps the list and shows a bottom Retry that re-requests the same cursor', async () => {
    const user = userEvent.setup();
    h.loadTimelinePageAction
      .mockResolvedValueOnce({ status: 'error', code: 'SERVER_ERROR' })
      .mockResolvedValueOnce({
        status: 'success',
        events: [genericEvent],
        nextCursor: null,
        additionalEventsCount: 3,
        droppedCount: 0,
      });
    renderTimeline(page1);

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText(/couldn’t load the provenance timeline/i)).toBeInTheDocument();
    // list preserved
    expect(screen.getByText('Artwork fractionalized into 10,000 shares')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Exhibited at the Oslo Contemporary')).toBeInTheDocument();
    expect(h.loadTimelinePageAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: NEXT_CURSOR }),
    );
  });

  it('T205: a rejected action (transport failure) shows the inline error + Retry, not a stuck spinner (#205)', async () => {
    const user = userEvent.setup();
    h.loadTimelinePageAction
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        status: 'success',
        events: [genericEvent],
        nextCursor: null,
        additionalEventsCount: 3,
        droppedCount: 0,
      });
    renderTimeline(page1);

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText(/reach the server/i)).toBeInTheDocument();
    expect(screen.getByText('Artwork fractionalized into 10,000 shares')).toBeInTheDocument(); // list preserved
    // recovers on Retry (lock was released → not a stuck spinner)
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Exhibited at the Oslo Contemporary')).toBeInTheDocument();
  });

  it('T33: a failed expand keeps the good collapsed list and does not flip the toggle label', async () => {
    const user = userEvent.setup();
    h.loadTimelinePageAction.mockResolvedValue({ status: 'error', code: 'RATE_LIMITED' });
    renderTimeline(page1);

    await user.click(screen.getByRole('button', { name: 'Show 3 more events' }));
    expect(await screen.findByText(/Loading too fast/i)).toBeInTheDocument();
    // good list kept, label unchanged (still collapsed)
    expect(screen.getByText('250 fractions traded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show 3 more events' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('T35: an empty initial shows the empty copy and no expand CTA', () => {
    renderTimeline({
      status: 'success',
      events: [],
      nextCursor: null,
      additionalEventsCount: 0,
      droppedCount: 0,
    });
    expect(screen.getByText('No provenance recorded yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('T36: empty with additionalEventsCount > 0 shows the expand invitation, not the empty copy', () => {
    renderTimeline({
      status: 'success',
      events: [],
      nextCursor: null,
      additionalEventsCount: 2,
      droppedCount: 0,
    });
    expect(screen.queryByText('No provenance recorded yet.')).not.toBeInTheDocument();
    expect(screen.getByText(/2 technical events available/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show 2 more events' })).toBeInTheDocument();
  });

  it('initial SSR error hydrates into a full-section error with a working Retry (no throw)', async () => {
    const user = userEvent.setup();
    h.loadTimelinePageAction.mockResolvedValue({ ...page1 });
    renderTimeline({ status: 'error', code: 'SERVER_ERROR' });
    expect(screen.getByText(/couldn’t load the provenance timeline/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('250 fractions traded')).toBeInTheDocument();
    expect(h.loadTimelinePageAction).toHaveBeenCalledWith(
      expect.objectContaining({ expand: false, cursor: undefined }),
    );
  });

  it('T37: droppedCount surfaces a single non-blocking notice', () => {
    renderTimeline({ ...page1, droppedCount: 2 });
    expect(screen.getByText('2 events couldn’t be shown.')).toBeInTheDocument();
  });

  it('T41/T42: Load more is a real focusable button and appended focus moves to the first new item', async () => {
    const user = userEvent.setup();
    h.loadTimelinePageAction.mockResolvedValue({
      status: 'success',
      events: [genericEvent],
      nextCursor: null,
      additionalEventsCount: 3,
      droppedCount: 0,
    });
    renderTimeline(page1);
    const btn = screen.getByRole('button', { name: 'Load more' });
    expect(btn.tagName).toBe('BUTTON');

    await user.click(btn);
    const newItem = await screen.findByText('Exhibited at the Oslo Contemporary');
    const li = newItem.closest('li')!;
    await waitFor(() => expect(li).toHaveFocus());
  });

  it('T204: stays functional under StrictMode (aliveRef live across the dev mount cycle) (#204)', async () => {
    const user = userEvent.setup();
    h.loadTimelinePageAction.mockResolvedValue({
      status: 'success',
      events: [genericEvent],
      nextCursor: null,
      additionalEventsCount: 3,
      droppedCount: 0,
    });
    render(
      <StrictMode>
        <ArtworkTimeline artworkId={TIMELINE_ARTWORK_ID} initial={page1} />
      </StrictMode>,
    );
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    // Before the fix, the StrictMode cleanup left aliveRef=false → this dispatch was swallowed and never rendered.
    expect(await screen.findByText('Exhibited at the Oslo Contemporary')).toBeInTheDocument();
  });
});
