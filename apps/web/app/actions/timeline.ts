'use server';

import { z } from 'zod/v4';
import { getArtworkTimeline, MAX_CURSOR_LEN } from '@/lib/services/timeline';
import type { TimelineResult } from '@/lib/types/api';

// Client-driven pagination/expand seam for the artwork timeline. A Server Action is a public POST endpoint
// reachable via a direct request (not just through the UI), so it re-validates EVERY input at the boundary and
// trusts nothing — the timeline is anonymous, so there is no cookie/token to read (unlike refreshHoldingsAction).
// It delegates to the SAME getArtworkTimeline the SSR path uses, so client and server can't drift. `cursor` is
// opaque: length-capped (shared MAX_CURSOR_LEN, #210) and forwarded verbatim, never parsed or constructed.

const uuidSchema = z.uuid();

export type LoadTimelinePageInput = {
  artworkId: string;
  expand?: boolean;
  cursor?: string;
  limit?: number;
};

export async function loadTimelinePageAction(
  input: LoadTimelinePageInput,
): Promise<TimelineResult> {
  // Untrusted input (direct-POST reachable) — runtime-guard each field regardless of the TS signature.
  if (!uuidSchema.safeParse(input?.artworkId).success) {
    return { status: 'error', code: 'ARTWORK_NOT_FOUND' }; // no existence oracle — same 404 as a hidden artwork
  }
  if (
    input.cursor !== undefined &&
    (typeof input.cursor !== 'string' || input.cursor.length > MAX_CURSOR_LEN)
  ) {
    return { status: 'error', code: 'INVALID_CURSOR' };
  }

  return getArtworkTimeline(input.artworkId, {
    expand: input.expand === true,
    cursor: input.cursor,
    // Leave clamping to the service (single source of truth); coerce a non-number to undefined here.
    limit: typeof input.limit === 'number' ? input.limit : undefined,
  });
}
