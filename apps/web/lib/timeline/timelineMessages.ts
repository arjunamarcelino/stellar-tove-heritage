import type { TimelineReadErrorCode } from '@/lib/types/api';

// Curated timeline error copy — never a raw backend string. Exactly-covering Record so an unmapped/renamed
// code fails to compile (mirrors lib/holdings/holdingsMessages.ts). Used for both the initial (SSR) error and
// the client tail/toggle errors.
export const TIMELINE_MESSAGES: Record<TimelineReadErrorCode, string> = {
  ARTWORK_NOT_FOUND: 'This provenance timeline is no longer available.',
  INVALID_CURSOR: 'We lost your place in the timeline. Please reload to continue.',
  RATE_LIMITED: 'Loading too fast — pause a moment, then try again.',
  NETWORK_ERROR: 'Couldn’t reach the server. Check your connection and try again.',
  SERVER_ERROR: 'We couldn’t load the provenance timeline. Please try again.',
};

// Static section copy kept beside the error map so all timeline strings live in one module.
export const TIMELINE_COPY = {
  eyebrow: 'Provenance',
  title: 'Timeline',
  empty: 'No provenance recorded yet.',
  // Shown when there are zero DEFAULT events but expandable events exist (contradictory-branch fix).
  emptyWithExpandable: (n: number) =>
    `${n} technical ${n === 1 ? 'event' : 'events'} available — show ${n === 1 ? 'it' : 'them'}.`,
  showMore: (n: number) => `Show ${n} more ${n === 1 ? 'event' : 'events'}`,
  showFewer: 'Show fewer',
  loadMore: 'Load more',
  loading: 'Loading…',
  retry: 'Retry',
  dropped: (n: number) => `${n} ${n === 1 ? 'event' : 'events'} couldn’t be shown.`,
  expandedAnnounce: 'Showing all events.',
  collapsedAnnounce: 'Showing summary.',
  appendedAnnounce: (n: number) => `${n} more ${n === 1 ? 'event' : 'events'} loaded.`,
} as const;
