import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  getArtworkTimeline: vi.fn(),
}));

vi.mock('@/lib/services/timeline', () => ({
  getArtworkTimeline: h.getArtworkTimeline,
  MAX_CURSOR_LEN: 512, // the action imports this shared bound (#210)
}));

import { loadTimelinePageAction } from '@/app/actions/timeline';
import { TIMELINE_ARTWORK_ID, NEXT_CURSOR } from '@/test/fixtures/timeline';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadTimelinePageAction', () => {
  it('delegates to getArtworkTimeline with the validated inputs and returns its result verbatim', async () => {
    const result = {
      status: 'success',
      events: [],
      nextCursor: null,
      additionalEventsCount: 0,
      droppedCount: 0,
    };
    h.getArtworkTimeline.mockResolvedValue(result);
    const out = await loadTimelinePageAction({
      artworkId: TIMELINE_ARTWORK_ID,
      expand: true,
      cursor: NEXT_CURSOR,
      limit: 30,
    });
    expect(out).toBe(result);
    expect(h.getArtworkTimeline).toHaveBeenCalledWith(TIMELINE_ARTWORK_ID, {
      expand: true,
      cursor: NEXT_CURSOR,
      limit: 30,
    });
  });

  it('defaults expand to false and limit to undefined when omitted', async () => {
    h.getArtworkTimeline.mockResolvedValue({
      status: 'success',
      events: [],
      nextCursor: null,
      additionalEventsCount: 0,
      droppedCount: 0,
    });
    await loadTimelinePageAction({ artworkId: TIMELINE_ARTWORK_ID });
    expect(h.getArtworkTimeline).toHaveBeenCalledWith(TIMELINE_ARTWORK_ID, {
      expand: false,
      cursor: undefined,
      limit: undefined,
    });
  });

  it('rejects a non-uuid artworkId → ARTWORK_NOT_FOUND without calling the service', async () => {
    expect(await loadTimelinePageAction({ artworkId: 'not-a-uuid' })).toEqual({
      status: 'error',
      code: 'ARTWORK_NOT_FOUND',
    });
    expect(h.getArtworkTimeline).not.toHaveBeenCalled();
  });

  it('rejects an oversized cursor (valid id) → INVALID_CURSOR without calling the service', async () => {
    expect(
      await loadTimelinePageAction({ artworkId: TIMELINE_ARTWORK_ID, cursor: 'x'.repeat(600) }),
    ).toEqual({ status: 'error', code: 'INVALID_CURSOR' });
    expect(h.getArtworkTimeline).not.toHaveBeenCalled();
  });

  it('coerces a non-boolean expand to false (never forwarded as an arbitrary value)', async () => {
    h.getArtworkTimeline.mockResolvedValue({
      status: 'success',
      events: [],
      nextCursor: null,
      additionalEventsCount: 0,
      droppedCount: 0,
    });
    // @ts-expect-error — simulating a hostile direct POST with a string expand
    await loadTimelinePageAction({ artworkId: TIMELINE_ARTWORK_ID, expand: 'yes' });
    expect(h.getArtworkTimeline).toHaveBeenCalledWith(
      TIMELINE_ARTWORK_ID,
      expect.objectContaining({ expand: false }),
    );
  });
});
