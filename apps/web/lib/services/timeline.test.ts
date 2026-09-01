import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { getArtworkTimeline } from '@/lib/services/timeline';
import {
  TIMELINE_ARTWORK_ID,
  NEXT_CURSOR,
  timelinePage1Wire,
  expandedPageWire,
  emptyPageWire,
  droppedPageWire,
  malformedEnvelopeWire,
  fractionalizationEvent,
  secondaryTradeEvent,
  secondaryTradeWire,
  fractionalizationWire,
} from '@/test/fixtures/timeline';

const OLD_ENV = process.env;

function stubFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  const fetchFn = vi.fn().mockResolvedValue({ ok, status, json: vi.fn().mockResolvedValue(body) });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

beforeEach(() => {
  process.env = { ...OLD_ENV, API_BASE_URL: 'https://api.test' };
});

afterEach(() => {
  process.env = OLD_ENV;
  vi.unstubAllGlobals();
});

describe('getArtworkTimeline', () => {
  it('T1/T19: GETs the default page (limit=20, no auth, no-store, timeout) and maps events in order', async () => {
    const fetchFn = stubFetch(200, timelinePage1Wire);
    const result = await getArtworkTimeline(TIMELINE_ARTWORK_ID);
    expect(result).toEqual({
      status: 'success',
      events: [fractionalizationEvent, secondaryTradeEvent],
      nextCursor: NEXT_CURSOR,
      additionalEventsCount: 3,
      droppedCount: 0,
    });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`https://api.test/v1/artworks/${TIMELINE_ARTWORK_ID}/timeline?limit=20`);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.cache).toBe('no-store');
    expect(init.next).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('T2: expand=true sends ?expand=true and preserves mixed visibility tiers', async () => {
    const fetchFn = stubFetch(200, expandedPageWire);
    const result = await getArtworkTimeline(TIMELINE_ARTWORK_ID, { expand: true });
    if (result.status !== 'success') throw new Error('expected success');
    expect(result.additionalEventsCount).toBe(0);
    expect(result.events.map((e) => e.visibilityTier)).toEqual(['default', 'expanded']);

    const [url] = fetchFn.mock.calls[0];
    expect(url).toContain('expand=true');
  });

  it('T3: fractionalization metadata (tokenAddress/deployLedger/txHash) is mapped intact', async () => {
    stubFetch(200, timelinePage1Wire);
    const r = await getArtworkTimeline(TIMELINE_ARTWORK_ID);
    if (r.status !== 'success') throw new Error('expected success');
    const ev = r.events[0];
    if (ev.eventType !== 'fractionalization') throw new Error('expected fractionalization');
    expect(ev.metadata).toEqual(fractionalizationEvent.metadata);
  });

  it('T4: secondary_trade money fields are strings, and there is NO txHash', async () => {
    stubFetch(200, timelinePage1Wire);
    const r = await getArtworkTimeline(TIMELINE_ARTWORK_ID);
    if (r.status !== 'success') throw new Error('expected success');
    const ev = r.events[1];
    if (ev.eventType !== 'secondary_trade') throw new Error('expected secondary_trade');
    expect(typeof ev.metadata.fractionCount).toBe('string');
    expect(typeof ev.metadata.pricePerFractionStroops).toBe('string');
    expect(ev.metadata.pricePerFractionStroops).toBe('123456789012345'); // no float coercion
    expect(ev.metadata).not.toHaveProperty('txHash');
  });

  it('T4b: a secondary_trade with invalid metadata (price "0") is DROPPED, not re-emitted with a live eventType (#202)', async () => {
    stubFetch(200, {
      ...timelinePage1Wire,
      events: [
        {
          ...secondaryTradeWire,
          metadata: { ...secondaryTradeWire.metadata, pricePerFractionStroops: '0' },
        },
      ],
    });
    const r = await getArtworkTimeline(TIMELINE_ARTWORK_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.events).toHaveLength(0); // dropped — never reaches the typed card branch
    expect(r.droppedCount).toBe(1);
  });

  it('T4c: a fractionalization missing tokenAddress is DROPPED (#202)', async () => {
    const partialMeta = {
      deployLedger: fractionalizationWire.metadata.deployLedger,
      txHash: fractionalizationWire.metadata.txHash,
    }; // tokenAddress omitted
    stubFetch(200, {
      ...timelinePage1Wire,
      events: [{ ...fractionalizationWire, metadata: partialMeta }],
    });
    const r = await getArtworkTimeline(TIMELINE_ARTWORK_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.events).toHaveLength(0);
    expect(r.droppedCount).toBe(1);
  });

  it('T4d: a generic/unknown type has its metadata STRIPPED to {} (no raw egress) (#202)', async () => {
    stubFetch(200, {
      ...emptyPageWire,
      events: [
        {
          id: '00000000-0000-4000-8000-0000000e0031',
          eventType: 'exhibition',
          visibilityTier: 'default',
          occurredAt: '2026-08-22T12:00:00.000Z',
          summary: 'Shown at Oslo',
          metadata: { venue: 'Oslo', secretInternalField: 'should-not-egress' },
        },
      ],
    });
    const r = await getArtworkTimeline(TIMELINE_ARTWORK_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.events).toHaveLength(1);
    expect(r.events[0].metadata).toEqual({}); // raw fields not forwarded to the client
  });

  it('T5/T6: absent/empty summary normalizes to null and the event survives', async () => {
    stubFetch(200, {
      ...emptyPageWire,
      events: [
        {
          id: '00000000-0000-4000-8000-0000000e0011',
          eventType: 'admin_note',
          visibilityTier: 'expanded',
          occurredAt: '2026-08-20T07:00:00.000Z',
          metadata: {},
        },
        {
          id: '00000000-0000-4000-8000-0000000e0012',
          eventType: 'technical',
          visibilityTier: 'expanded',
          occurredAt: '2026-08-20T06:00:00.000Z',
          summary: '   ',
          metadata: {},
        },
      ],
    });
    const r = await getArtworkTimeline(TIMELINE_ARTWORK_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.events).toHaveLength(2);
    expect(r.events.every((e) => e.summary === null)).toBe(true);
  });

  it('T7: an empty timeline is a SUCCESS with events:[] (not a 404)', async () => {
    stubFetch(200, emptyPageWire);
    expect(await getArtworkTimeline(TIMELINE_ARTWORK_ID)).toEqual({
      status: 'success',
      events: [],
      nextCursor: null,
      additionalEventsCount: 0,
      droppedCount: 0,
    });
  });

  it('T8: forwards cursor + limit verbatim and echoes nextCursor', async () => {
    const fetchFn = stubFetch(200, timelinePage1Wire);
    const r = await getArtworkTimeline(TIMELINE_ARTWORK_ID, { cursor: NEXT_CURSOR, limit: 30 });
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.nextCursor).toBe(NEXT_CURSOR); // opaque, not decoded

    const [url] = fetchFn.mock.calls[0];
    expect(url).toBe(
      `https://api.test/v1/artworks/${TIMELINE_ARTWORK_ID}/timeline?limit=30&cursor=${encodeURIComponent(NEXT_CURSOR)}`,
    );
  });

  it('T9: SEC-1 rejects a non-uuid id → ARTWORK_NOT_FOUND without fetching', async () => {
    const fetchFn = stubFetch(200, timelinePage1Wire);
    expect(await getArtworkTimeline('not-a-uuid')).toEqual({
      status: 'error',
      code: 'ARTWORK_NOT_FOUND',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    [
      'errorCode body',
      { statusCode: 404, errorCode: 'ARTWORK_NOT_FOUND', message: 'Artwork not found' },
    ],
    ['codeless body', { statusCode: 404, error: 'Not Found' }],
  ])('T10: a 404 (%s) → ARTWORK_NOT_FOUND', async (_label, body) => {
    stubFetch(404, body);
    expect(await getArtworkTimeline(TIMELINE_ARTWORK_ID)).toEqual({
      status: 'error',
      code: 'ARTWORK_NOT_FOUND',
    });
  });

  it('T11: a 400 TIMELINE_INVALID_CURSOR → INVALID_CURSOR', async () => {
    stubFetch(400, {
      statusCode: 400,
      errorCode: 'TIMELINE_INVALID_CURSOR',
      message: 'bad cursor',
    });
    expect(await getArtworkTimeline(TIMELINE_ARTWORK_ID)).toEqual({
      status: 'error',
      code: 'INVALID_CURSOR',
    });
  });

  it('T12: a generic 400 (no code) → SERVER_ERROR (distinct from INVALID_CURSOR)', async () => {
    stubFetch(400, { statusCode: 400, message: 'validation failed' });
    expect(await getArtworkTimeline(TIMELINE_ARTWORK_ID)).toEqual({
      status: 'error',
      code: 'SERVER_ERROR',
    });
  });

  it('T13: a 429 → RATE_LIMITED', async () => {
    stubFetch(429, { statusCode: 429, message: 'Too Many Requests' });
    expect(await getArtworkTimeline(TIMELINE_ARTWORK_ID)).toEqual({
      status: 'error',
      code: 'RATE_LIMITED',
    });
  });

  it('T14: a 500 → SERVER_ERROR; a transport failure (no API_BASE_URL) → NETWORK_ERROR', async () => {
    stubFetch(500, { statusCode: 500 });
    expect(await getArtworkTimeline(TIMELINE_ARTWORK_ID)).toEqual({
      status: 'error',
      code: 'SERVER_ERROR',
    });

    delete process.env.API_BASE_URL;
    expect(await getArtworkTimeline(TIMELINE_ARTWORK_ID)).toEqual({
      status: 'error',
      code: 'NETWORK_ERROR',
    });
  });

  it('T15: one malformed event is dropped (fail-open), valid events returned, droppedCount=1', async () => {
    stubFetch(200, droppedPageWire);
    const r = await getArtworkTimeline(TIMELINE_ARTWORK_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toEqual(fractionalizationEvent);
    expect(r.droppedCount).toBe(1);
  });

  it('T16: a structurally-broken envelope (events not an array) → SERVER_ERROR (fail-closed)', async () => {
    stubFetch(200, malformedEnvelopeWire);
    expect(await getArtworkTimeline(TIMELINE_ARTWORK_ID)).toEqual({
      status: 'error',
      code: 'SERVER_ERROR',
    });
  });

  it('T16b: an OMITTED nextCursor reads as "last page" (null), events intact (#206)', async () => {
    stubFetch(200, { events: [fractionalizationWire], additionalEventsCount: 0 }); // no nextCursor key
    const r = await getArtworkTimeline(TIMELINE_ARTWORK_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.nextCursor).toBeNull();
    expect(r.events).toHaveLength(1);
  });

  it('T16c: a wrong-TYPE nextCursor (number) still fails closed → SERVER_ERROR (#206)', async () => {
    stubFetch(200, { ...timelinePage1Wire, nextCursor: 42 });
    expect(await getArtworkTimeline(TIMELINE_ARTWORK_ID)).toEqual({
      status: 'error',
      code: 'SERVER_ERROR',
    });
  });

  it('T17: clamps limit out of range (999 → 50, 0 → 1)', async () => {
    const hi = stubFetch(200, emptyPageWire);
    await getArtworkTimeline(TIMELINE_ARTWORK_ID, { limit: 999 });
    expect(hi.mock.calls[0][0]).toContain('limit=50');

    vi.unstubAllGlobals();
    const lo = stubFetch(200, emptyPageWire);
    await getArtworkTimeline(TIMELINE_ARTWORK_ID, { limit: 0 });
    expect(lo.mock.calls[0][0]).toContain('limit=1');
  });

  it('T18: an oversized cursor fails CLOSED → INVALID_CURSOR without fetching (parity with the action) (#210)', async () => {
    const fetchFn = stubFetch(200, emptyPageWire);
    expect(await getArtworkTimeline(TIMELINE_ARTWORK_ID, { cursor: 'x'.repeat(600) })).toEqual({
      status: 'error',
      code: 'INVALID_CURSOR',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('degrades a non-integer additionalEventsCount to 0 rather than blanking the page', async () => {
    stubFetch(200, { ...timelinePage1Wire, additionalEventsCount: 'lots' });
    const r = await getArtworkTimeline(TIMELINE_ARTWORK_ID);
    if (r.status !== 'success') throw new Error('expected success');
    expect(r.additionalEventsCount).toBe(0);
    expect(r.events).toHaveLength(2); // page still renders
  });

  it('T207a: the default page-1 view with `revalidate` is data-cached (next tags), not no-store (#207)', async () => {
    const fetchFn = stubFetch(200, timelinePage1Wire);
    await getArtworkTimeline(TIMELINE_ARTWORK_ID, { revalidate: 300 });
    const [, init] = fetchFn.mock.calls[0];
    expect(init.cache).toBeUndefined();
    expect(init.next).toEqual({
      revalidate: 300,
      tags: ['artwork-timeline', `artwork-timeline:${TIMELINE_ARTWORK_ID}`],
    });
  });

  it.each([
    ['cursor', { revalidate: 300, cursor: NEXT_CURSOR }],
    ['expand', { revalidate: 300, expand: true }],
  ])('T207b: a %s-scoped read stays no-store even with revalidate (#207)', async (_label, opts) => {
    const fetchFn = stubFetch(200, expandedPageWire);
    await getArtworkTimeline(TIMELINE_ARTWORK_ID, opts);
    const [, init] = fetchFn.mock.calls[0];
    expect(init.cache).toBe('no-store');
    expect(init.next).toBeUndefined();
  });
});
