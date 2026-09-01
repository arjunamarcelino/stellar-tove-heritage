'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { mintIdempotencyKey } from '@/lib/idempotency';
import { QUOTE_MESSAGES } from '@/lib/quote/quoteMessages';
import type {
  Quote,
  QuoteError,
  QuoteInput,
  SubmitQuoteAction,
  SubmitQuoteResult,
} from '@/lib/types/api';

// The quote-submission orchestrator (TOV-176 / FR-06.03). A copy of useCreateRfq: a single POST, no signing, no
// poll. The state machine is idle → submitting → created | error; every non-201 outcome (incl. 409/401/422/503)
// is an `error` arm and retry is manual — no auto-retry loop.
//
// Idempotency (SEC-4): one key minted per submit and held in keyRef; a manual retry REUSES the same key (incl.
// after a 409 IN_FLIGHT and a retryable 503 — the outcome is unknown, so the same key replays the stored result
// or re-attempts), EXCEPT after a 422 MISMATCH where a fresh key is minted. The body is FROZEN at submit
// (bodyRef) — including the resolved `validUntil` instant — so a retry replays a byte-identical body, never live
// field values (C1: a recomputed validUntil would 422/MISMATCH a possibly-created quote). Editing any field and
// resubmitting goes through submit() → a fresh key (C2: correct for the balance-freed case under either backend
// idempotency semantics). busyRef single-flights submit AND retry; aliveRef guards setState after unmount
// (two-sided so a StrictMode remount re-arms it); epochRef drops a superseded response.

export type QuoteFlowState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'created'; quote: Quote }
  | ({ status: 'error' } & QuoteError);

export interface UseSubmitQuoteReturn {
  state: QuoteFlowState;
  submit: (input: QuoteInput) => void;
  retry: () => void;
  reset: () => void;
}

export function useSubmitQuote(rfqId: string, action: SubmitQuoteAction): UseSubmitQuoteReturn {
  const [state, setStateRaw] = useState<QuoteFlowState>({ status: 'idle' });
  const stateRef = useRef<QuoteFlowState>(state);
  const keyRef = useRef<string | null>(null); // frozen idempotency key (SEC-4)
  const bodyRef = useRef<QuoteInput | null>(null); // frozen body snapshot (incl. resolved validUntil)
  const busyRef = useRef(false); // single-flights submit AND retry
  const aliveRef = useRef(true); // unmount guard (two-sided)
  const epochRef = useRef(0); // generation guard

  const setState = useCallback((next: QuoteFlowState) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  // Two-sided: set true on mount so a StrictMode/real remount re-arms the guard, false on cleanup.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    const epoch = epochRef.current;
    const key = keyRef.current;
    const body = bodyRef.current;
    if (!key || !body) return; // guarded by submit()/retry(), which set both before calling run
    let result: SubmitQuoteResult;
    try {
      result = await action(rfqId, body, key);
    } catch {
      result = {
        status: 'error' as const,
        code: 'SERVER_ERROR' as const,
        message: QUOTE_MESSAGES.SERVER_ERROR,
      };
    }
    // Drop if unmounted or superseded by a newer attempt / reset.
    if (!aliveRef.current || epoch !== epochRef.current) return;
    setState(result.status === 'success' ? { status: 'created', quote: result.quote } : result);
  }, [action, rfqId, setState]);

  const start = useCallback(
    (freshKey: boolean, input: QuoteInput) => {
      if (busyRef.current) return; // single-flight
      busyRef.current = true;
      epochRef.current += 1;
      const epoch = epochRef.current;
      bodyRef.current = input; // freeze the body snapshot (incl. resolved validUntil)
      if (freshKey || !keyRef.current) keyRef.current = mintIdempotencyKey();
      setState({ status: 'submitting' });
      // Only release busyRef if THIS attempt is still current — a reset/new submit that superseded us (bumping
      // the epoch, and possibly already re-acquiring busyRef) must keep its own latch.
      void run().finally(() => {
        if (aliveRef.current && epochRef.current === epoch) busyRef.current = false;
      });
    },
    [run, setState],
  );

  // New attempt → fresh key + fresh body snapshot (C2: every deliberate resubmit, incl. after INSUFFICIENT).
  const submit = useCallback((input: QuoteInput) => start(true, input), [start]);

  // Retry the frozen body with the SAME key, except mint a fresh key after a 422 MISMATCH.
  const retry = useCallback(() => {
    const s = stateRef.current;
    if (s.status !== 'error' || !bodyRef.current) return;
    start(s.code === 'IDEMPOTENCY_KEY_MISMATCH', bodyRef.current);
  }, [start]);

  // Reset for a new quote: clear the frozen key + body and bump the epoch so any in-flight response is dropped.
  // Also release busyRef — the epoch bump already neutralizes the orphaned resolve, and leaving busyRef set
  // would silently swallow the next submit until the orphaned request settled.
  const reset = useCallback(() => {
    epochRef.current += 1;
    keyRef.current = null;
    bodyRef.current = null;
    busyRef.current = false;
    setState({ status: 'idle' });
  }, [setState]);

  return { state, submit, retry, reset };
}
