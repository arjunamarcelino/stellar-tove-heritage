'use client';

import { useId, useState } from 'react';
import { PROFILE_COPY } from '@/lib/profile/profileMessages';

const COLLAPSED_COUNT = 2; // show ≤2 inline; expander only when > 2

interface Props {
  handles: readonly string[]; // already normalized by the backend; `readonly` — never mutated here
}

// "previously known as @a, @b  +N more" (TOV-44 / FR-01.06). Handles are plain text, NOT links (old
// routes 404). They are ASCII [A-Za-z0-9._-] (handleSchema) → no bidi/RTL, so no <bdi> needed.
// Progressive enhancement: ALL handles render in the SSR DOM; the tail is hidden via the `hidden`
// attribute and revealed by the toggle → no-JS/crawler users still get the full history, and
// aria-controls points at content that genuinely toggles (WAI-ARIA APG disclosure pattern). Collapsed
// is the initial SSR state, so first client render matches the server markup (no hydration mismatch).
export default function PreviouslyKnownAs({ handles }: Props) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  if (handles.length === 0) return null; // "no previous handles, no line"

  const hasMore = handles.length > COLLAPSED_COUNT;
  const remaining = handles.length - COLLAPSED_COUNT;

  return (
    <p className="mt-2 text-sm text-flint">
      {PROFILE_COPY.previouslyKnownAsLabel}{' '}
      <span id={listId}>
        {handles.map((handle, i) => (
          // key={handle}: the backend dedupes by canonical, so each handle is unique — no index needed.
          // The HTML `hidden` attribute drives the collapse (works in jsdom + semantic). Do NOT add a
          // Tailwind `display` utility (inline/flex/…) to this span: a class would override `hidden` and
          // silently break the collapse while the jsdom `toBeVisible` test stays green (todo 115).
          <span key={handle} hidden={hasMore && !expanded && i >= COLLAPSED_COUNT}>
            {i > 0 ? ', ' : ''}
            <span className="break-words">@{handle}</span>
          </span>
        ))}
      </span>
      {hasMore && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-label={
            expanded ? PROFILE_COPY.collapseAriaLabel : PROFILE_COPY.expandAriaLabel(remaining)
          }
          onClick={() => setExpanded((prev) => !prev)}
          className="ml-1 inline-flex min-h-[44px] items-center underline underline-offset-2"
        >
          {expanded ? PROFILE_COPY.showLess : PROFILE_COPY.moreLabel(remaining)}
        </button>
      )}
    </p>
  );
}
