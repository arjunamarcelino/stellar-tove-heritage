'use client';

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { loadTimelinePageAction } from '@/app/actions/timeline';
import TimelineEventCard from '@/components/artwork/TimelineEventCard';
import { SECONDARY_BUTTON } from '@/components/ui/buttons';
import { ERROR_CLASS, MUTED_LINK } from '@/components/ui/surfaces';
import { TIMELINE_COPY, TIMELINE_MESSAGES } from '@/lib/timeline/timelineMessages';
import type { TimelineEvent, TimelineReadErrorCode, TimelineResult } from '@/lib/types/api';

// Client timeline (TOV-192). Hydrates with the SSR `initial` page and drives cursor pagination (append) + the
// expand toggle (replace) through the loadTimelinePageAction Server Action. Establishes the repo's first
// infinite-scroll pattern; the reducer transitions events/cursor/expand/count/droppedCount/tailStatus ATOMICALLY
// across three operations. Race-safety rests on TWO things (mutual single-flight alone is necessary but NOT
// sufficient): (1) MUTUAL single-flight — inFlightRef gates both append and toggle, blocking a *concurrent*
// start; (2) COMMIT-ORDERED lock release — inFlightRef is freed in a passive effect after the transition commits
// (and after the observer's closure is refreshed), NOT in a `finally`, so a re-entering observer can never read a
// stale cursor/expand. Releasing pre-commit was a real duplicate/cross-tier race (#203).

const EMPTY_FOLLOW_CAP = 3; // stop after N consecutive empty-but-non-null-cursor pages (backend-bug backstop)

type TailStatus = 'idle' | 'loading' | 'error';

interface State {
  events: TimelineEvent[];
  cursor: string | null; // mode-scoped; advances only on a successful append
  expand: boolean;
  additionalEventsCount: number; // from the CURRENT page-1 response; drives the toggle label
  droppedCount: number; // ACCUMULATED across appended pages
  tailStatus: TailStatus;
  tailError: TimelineReadErrorCode | null;
  emptyFollowStreak: number;
}

type Action =
  | { type: 'APPEND_START' }
  | { type: 'APPEND_OK'; events: TimelineEvent[]; nextCursor: string | null; addDropped: number }
  | { type: 'APPEND_ERR'; code: TimelineReadErrorCode }
  | { type: 'REPLACE_START' }
  | {
      type: 'REPLACE_OK';
      expand: boolean;
      events: TimelineEvent[];
      nextCursor: string | null;
      additionalEventsCount: number;
      droppedCount: number;
    }
  | { type: 'REPLACE_ERR'; code: TimelineReadErrorCode };

function initState(initial: TimelineResult): State {
  if (initial.status === 'success') {
    return {
      events: initial.events,
      cursor: initial.nextCursor,
      expand: false,
      additionalEventsCount: initial.additionalEventsCount,
      droppedCount: initial.droppedCount,
      tailStatus: 'idle',
      tailError: null,
      emptyFollowStreak: 0,
    };
  }
  // SSR page-1 failure → hydrate straight into the inline error (never thrown to app/error.tsx). Retry re-fetches.
  return {
    events: [],
    cursor: null,
    expand: false,
    additionalEventsCount: 0,
    droppedCount: 0,
    tailStatus: 'error',
    tailError: initial.code,
    emptyFollowStreak: 0,
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'APPEND_START':
      return { ...state, tailStatus: 'loading' };
    case 'APPEND_OK': {
      const emptyFollow = action.events.length === 0 && action.nextCursor !== null;
      const streak = emptyFollow ? state.emptyFollowStreak + 1 : 0;
      // Stop paging if the backend keeps handing back empty-but-non-null cursors (would spin + burn the rate limit).
      const cursor = streak >= EMPTY_FOLLOW_CAP ? null : action.nextCursor;
      return {
        ...state,
        events: [...state.events, ...action.events],
        cursor,
        droppedCount: state.droppedCount + action.addDropped,
        tailStatus: 'idle',
        tailError: null,
        emptyFollowStreak: streak,
      };
    }
    case 'APPEND_ERR':
      // Keep the loaded list; the sentinel unmounts (tailStatus:error) so the observer can't re-fire.
      return { ...state, tailStatus: 'error', tailError: action.code };
    case 'REPLACE_START':
      // Keep the current list visible (aria-busy) — no empty flash while page 1 re-fetches.
      return { ...state, tailStatus: 'loading' };
    case 'REPLACE_OK':
      return {
        ...state,
        events: action.events,
        cursor: action.nextCursor,
        expand: action.expand,
        additionalEventsCount: action.additionalEventsCount,
        droppedCount: action.droppedCount, // reset (new session), not accumulated
        tailStatus: 'idle',
        tailError: null,
        emptyFollowStreak: 0,
      };
    case 'REPLACE_ERR':
      // Keep the good list; expand is unchanged so the toggle label already matches what's shown.
      return { ...state, tailStatus: 'error', tailError: action.code };
    default: {
      // Exhaustiveness guard (#209): a new Action variant fails to compile here rather than silently no-op'ing.
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export default function ArtworkTimeline({
  artworkId,
  initial,
}: {
  artworkId: string;
  initial: TimelineResult;
}) {
  const [state, dispatch] = useReducer(reducer, initial, initState);
  const [isPending, startTransition] = useTransition();
  const [announce, setAnnounce] = useState('');

  // Synchronous MUTUAL single-flight lock — gates append AND toggle, independent of isPending's render timing.
  const inFlightRef = useRef(false);
  // Liveness: an in-flight action can resolve after unmount; never touch state then. Set true in the BODY too —
  // StrictMode (Next dev default) runs setup→cleanup→setup on the same ref, so a cleanup-only reset would leave
  // aliveRef.current === false on the live remount and silently swallow every load/toggle (#204).
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const listRef = useRef<HTMLOListElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  // Index of the first newly-appended item to focus after a MANUAL load-more (observer loads move nothing).
  const pendingFocusRef = useRef<number | null>(null);

  useEffect(() => {
    if (pendingFocusRef.current === null) return;
    const idx = pendingFocusRef.current;
    pendingFocusRef.current = null;
    const li = listRef.current?.children[idx] as HTMLElement | undefined;
    li?.focus();
  }, [state.events]);

  function scrollSectionIntoView() {
    const el = sectionRef.current;
    if (!el || typeof el.scrollIntoView !== 'function') return;
    // Honour reduced-motion: jump, not smooth. matchMedia is guarded for SSR/jsdom (undefined there).
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    try {
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    } catch {
      /* jsdom / unsupported — no-op */
    }
  }

  // Announce into the polite live region, clearing first so a REPEATED identical message still changes the DOM
  // text node and is re-spoken (a live region whose text doesn't change is silent). #208.
  function announceMessage(msg: string) {
    setAnnounce('');
    requestAnimationFrame(() => {
      if (aliveRef.current) setAnnounce(msg);
    });
  }

  function loadMore(source: 'observer' | 'manual') {
    if (inFlightRef.current) return; // mutual single-flight
    if (state.cursor === null) return; // no more pages
    // No tailStatus:'error' guard: the sentinel is unmounted on error (observer can't fire), and the bottom
    // Retry button must be able to re-request the same cursor from here.
    inFlightRef.current = true;
    const cursorAtDispatch = state.cursor; // retry re-requests THIS cursor (advances only on success)
    const prevLength = state.events.length;
    dispatch({ type: 'APPEND_START' });
    startTransition(async () => {
      try {
        const next = await loadTimelinePageAction({
          artworkId,
          expand: state.expand,
          cursor: cursorAtDispatch,
        });
        if (!aliveRef.current) return;
        if (next.status === 'error') {
          dispatch({ type: 'APPEND_ERR', code: next.code });
          return;
        }
        if (source === 'manual') pendingFocusRef.current = prevLength; // focus first new item (manual only)
        dispatch({
          type: 'APPEND_OK',
          events: next.events,
          nextCursor: next.nextCursor,
          addDropped: next.droppedCount,
        });
        if (source === 'manual' && next.events.length > 0) {
          announceMessage(TIMELINE_COPY.appendedAnnounce(next.events.length)); // observer loads stay silent
        }
      } catch {
        // The Server Action ROUND-TRIP itself failed (dropped connection) — the service never throws, but the
        // client→action transport can. Surface the inline Retry instead of a stuck spinner (#205).
        if (aliveRef.current) dispatch({ type: 'APPEND_ERR', code: 'NETWORK_ERROR' });
      }
    });
    // inFlightRef is released in a COMMIT-ORDERED effect (see below), NOT in a `finally` — releasing in `finally`
    // freed the lock before the transition committed, so the still-intersecting observer could re-enter with a
    // stale closure (duplicate/cross-tier appends). #203.
  }

  // Used by the expand toggle (targetExpand = !expand) AND the initial-error Retry (targetExpand = current expand).
  function replaceFromFirstPage(targetExpand: boolean) {
    if (inFlightRef.current) return; // mutual single-flight — no toggle mid-append
    inFlightRef.current = true;
    const collapsing = !targetExpand && state.expand;
    dispatch({ type: 'REPLACE_START' });
    startTransition(async () => {
      try {
        const res = await loadTimelinePageAction({
          artworkId,
          expand: targetExpand,
          cursor: undefined,
        });
        if (!aliveRef.current) return;
        if (res.status === 'error') {
          dispatch({ type: 'REPLACE_ERR', code: res.code });
          return;
        }
        dispatch({
          type: 'REPLACE_OK',
          expand: targetExpand,
          events: res.events,
          nextCursor: res.nextCursor,
          additionalEventsCount: res.additionalEventsCount,
          droppedCount: res.droppedCount,
        });
        announceMessage(
          targetExpand ? TIMELINE_COPY.expandedAnnounce : TIMELINE_COPY.collapsedAnnounce,
        );
        if (collapsing) scrollSectionIntoView(); // a shrinking list can strand the user in whitespace
      } catch {
        if (aliveRef.current) dispatch({ type: 'REPLACE_ERR', code: 'NETWORK_ERROR' }); // transport failure (#205)
      }
    });
    // Lock released in the commit-ordered effect below (see #203 note in loadMore).
  }

  // React 19 cleanup-returning callback ref: mount = observe, unmount = disconnect. The sentinel is only rendered
  // while there are more pages and no tail error, so conditional rendering IS the disconnect/re-arm mechanism.
  const loadMoreRef = useRef(loadMore);
  // Keep the observer's callback pointing at the latest closure (no stale cursor/expand) — updated in an effect,
  // not during render, so it doesn't trip react-hooks/refs.
  useEffect(() => {
    loadMoreRef.current = loadMore;
  });
  // Commit-ordered single-flight release (#203). Declared AFTER the loadMoreRef effect so, in the same commit,
  // the observer's closure is refreshed BEFORE the lock frees — a re-entering observer then reads the fresh
  // cursor/expand, never a stale one. Releasing in a `finally` (pre-commit) is what caused the duplicate /
  // cross-tier race. The synchronous `inFlightRef = true` at dispatch still guards rapid double-clicks (T29).
  useEffect(() => {
    if (state.tailStatus !== 'loading') inFlightRef.current = false;
  }, [state.tailStatus, state.events]);
  const sentinelRef = useCallback((node: HTMLButtonElement | null) => {
    if (!node) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMoreRef.current('observer');
      },
      { rootMargin: '200px 0px', threshold: 0 }, // prefetch ~200px before the sentinel enters the viewport
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  const errorMessage = state.tailError ? TIMELINE_MESSAGES[state.tailError] : '';

  // ── Full-section error: SSR page-1 failed (or the initial-error Retry failed) with nothing to show ──
  if (state.tailStatus === 'error' && state.events.length === 0) {
    return (
      <TimelineShell sectionRef={sectionRef} announce={announce}>
        <div className={ERROR_CLASS}>
          <p>{errorMessage}</p>
          <button
            type="button"
            onClick={() => replaceFromFirstPage(state.expand)}
            aria-disabled={isPending}
            aria-busy={isPending}
            className={`${MUTED_LINK} mt-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
          >
            {isPending ? TIMELINE_COPY.loading : TIMELINE_COPY.retry}
          </button>
        </div>
      </TimelineShell>
    );
  }

  // ── Empty (visible artwork, no events yet) ──
  if (state.events.length === 0) {
    const inviteExpand = !state.expand && state.additionalEventsCount > 0;
    return (
      <TimelineShell sectionRef={sectionRef} announce={announce}>
        <div className="rounded-md border border-charcoal/15 bg-charcoal/5 p-6 text-sm text-charcoal">
          <p>
            {inviteExpand
              ? TIMELINE_COPY.emptyWithExpandable(state.additionalEventsCount)
              : TIMELINE_COPY.empty}
          </p>
          {inviteExpand ? (
            <ExpandToggle
              expand={state.expand}
              additionalEventsCount={state.additionalEventsCount}
              isPending={isPending}
              onToggle={replaceFromFirstPage}
              className="mt-4"
            />
          ) : null}
        </div>
      </TimelineShell>
    );
  }

  const showExpandToggle = state.expand || state.additionalEventsCount > 0;

  let tail: ReactNode = null;
  if (state.tailStatus === 'error') {
    // A page-N failure: keep the loaded list, offer a bottom retry (re-requests the same cursor).
    tail = (
      <div className={`${ERROR_CLASS} mt-4`}>
        <p>{errorMessage}</p>
        <button
          type="button"
          onClick={() => loadMore('manual')}
          aria-disabled={isPending}
          aria-busy={isPending}
          className={`${MUTED_LINK} mt-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
        >
          {isPending ? TIMELINE_COPY.loading : TIMELINE_COPY.retry}
        </button>
      </div>
    );
  } else if (state.cursor !== null) {
    // The sentinel IS a real focusable button: observer auto-loads for scroll users; keyboard/SR/no-JS click it.
    tail = (
      <button
        ref={sentinelRef}
        type="button"
        onClick={() => loadMore('manual')}
        aria-disabled={isPending}
        aria-busy={isPending}
        className={`${SECONDARY_BUTTON} mt-4 w-full aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
      >
        {isPending ? TIMELINE_COPY.loading : TIMELINE_COPY.loadMore}
      </button>
    );
  }

  return (
    <TimelineShell sectionRef={sectionRef} announce={announce}>
      {state.droppedCount > 0 ? (
        <p className="mb-4 rounded-md border border-ochre/40 bg-ochre/10 p-3 text-sm text-umber">
          {TIMELINE_COPY.dropped(state.droppedCount)}
        </p>
      ) : null}
      <ol
        ref={listRef}
        id="artwork-timeline-events"
        role="list"
        aria-busy={state.tailStatus === 'loading'}
        className="flex flex-col gap-3"
      >
        {state.events.map((event) => (
          <TimelineEventCard key={event.id} event={event} />
        ))}
      </ol>
      {tail}
      {showExpandToggle ? (
        <ExpandToggle
          expand={state.expand}
          additionalEventsCount={state.additionalEventsCount}
          isPending={isPending}
          onToggle={replaceFromFirstPage}
          className="mt-4"
        />
      ) : null}
    </TimelineShell>
  );
}

// Disclosure control (WAI-ARIA): "Show N more events" ⇄ "Show fewer". aria-expanded reflects the shown list.
// Takes only the fields it reads (not the whole reducer State) so the leaf button isn't coupled to the shape.
function ExpandToggle({
  expand,
  additionalEventsCount,
  isPending,
  onToggle,
  className = '',
}: {
  expand: boolean;
  additionalEventsCount: number;
  isPending: boolean;
  onToggle: (targetExpand: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={expand}
      aria-controls="artwork-timeline-events"
      onClick={() => onToggle(!expand)}
      aria-disabled={isPending}
      aria-busy={isPending}
      className={`${MUTED_LINK} ${className} inline-flex min-h-[44px] items-center aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
    >
      {expand ? TIMELINE_COPY.showFewer : TIMELINE_COPY.showMore(additionalEventsCount)}
    </button>
  );
}

function TimelineShell({
  sectionRef,
  announce,
  children,
}: {
  sectionRef: React.RefObject<HTMLElement | null>;
  announce: string;
  children: ReactNode;
}) {
  return (
    <section ref={sectionRef} aria-labelledby="artwork-timeline-heading">
      <h2 id="artwork-timeline-heading" className="mb-4 font-heading text-xl text-charcoal">
        <span className="mb-1 block text-xs font-medium uppercase tracking-widest text-flint">
          {TIMELINE_COPY.eyebrow}
        </span>
        {TIMELINE_COPY.title}
      </h2>
      {/* Persistent (always-mounted) polite live region — never conditionally rendered, or it won't announce. */}
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {children}
    </section>
  );
}
