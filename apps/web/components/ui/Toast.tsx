'use client';

import { useEffect, useRef } from 'react';
import { MUTED_LINK } from '@/components/ui/surfaces';

// A save-flow toast auto-dismisses after ~4s. Long enough to read a short confirmation, short enough not to
// linger; the parent can also dismiss it manually or replace it (which re-arms the timer via `message`).
const TOAST_DISMISS_MS = 4_000;

interface Props {
  message: string;
  tone: 'success' | 'error';
  onDismiss: () => void;
}

// Presentational, self-dismissing status toast. Cross-feature UI primitive (promoted from the
// profile-settings flow, TOV-35; reused by the wallet trustline flow, TOV-47). No context / provider —
// the PARENT owns whether a toast exists; this only renders + announces the one it's given. A success is
// a polite status; an error is an assertive alert (interrupts the SR queue). It never steals focus — a
// toast must not yank the caret out of whatever the user is doing, so the live region does the
// announcing. The timer is cleared on unmount and re-armed whenever the message/tone changes.
export default function Toast({ message, tone, onDismiss }: Props) {
  // Keep the latest onDismiss without re-arming the timer when the parent passes a new inline closure.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useEffect(() => {
    const id = setTimeout(() => onDismissRef.current(), TOAST_DISMISS_MS);
    return () => clearTimeout(id);
  }, [message, tone]);

  const isError = tone === 'error';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={`flex items-center justify-between gap-3 rounded-md border p-4 text-sm ${
        isError
          ? 'border-sienna/50 bg-sienna/10 text-umber'
          : 'border-ochre/40 bg-ochre/10 text-umber'
      }`}
    >
      <span>{message}</span>
      <button type="button" onClick={onDismiss} className={`shrink-0 ${MUTED_LINK}`}>
        Dismiss
      </button>
    </div>
  );
}
