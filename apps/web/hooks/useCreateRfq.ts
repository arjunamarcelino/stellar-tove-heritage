'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { mintIdempotencyKey } from '@/lib/idempotency';
import { RFQ_MESSAGES } from '@/lib/rfq/rfqMessages';
import type {
  CreateRfqAction,
  CreateRfqResult,
  Rfq,
  RfqErrorCode,
  RfqInput,
} from '@/lib/types/api';

// The RFQ create orchestrator (TOV-173 / FR-06.01, WS-C). A cut-down useBidFlow: a single POST, no signing, no
// poll. The state machine is idle → submitting → created | error; every non-201 outcome (incl. 409/401/422) is
// an `error { code }` arm and retry is manual — no auto-retry loop.
//
// Idempotency (SEC-4): one key minted per submit and held in keyRef; a manual retry REUSES the same key (incl.
// after a 409 IN_FLIGHT — the server has finished, so the same key replays the 201), EXCEPT after a 422
// MISMATCH where a fresh key is minted. The body is frozen at submit (bodyRef) so a retry replays a
// byte-identical body, never live field values (else 422 MISMATCH). busyRef single-flights submit AND retry;
// aliveRef guards setState after unmount (two-sided so a StrictMode remount re-arms it); epochRef drops a
// superseded response (submit → makeAnother → late resolve) so it can't paint over the fresh state.

export type RfqFlowState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'created'; rfq: Rfq }
  | { status: 'error'; code: RfqErrorCode; message: string };

export interface UseCreateRfqReturn {
  state: RfqFlowState;
  submit: (input: RfqInput) => void;
  retry: () => void;
  makeAnother: () => void;
}

export function useCreateRfq(artworkId: string, action: CreateRfqAction): UseCreateRfqReturn {
  const [state, setStateRaw] = useState<RfqFlowState>({ status: 'idle' });
  const stateRef = useRef<RfqFlowState>(state);
  const keyRef = useRef<string | null>(null); // frozen idempotency key (SEC-4)
  const bodyRef = useRef<RfqInput | null>(null); // frozen body snapshot
  const busyRef = useRef(false); // single-flights submit AND retry
  const aliveRef = useRef(true); // unmount guard (two-sided)
  const epochRef = useRef(0); // generation guard

  const setState = useCallback((next: RfqFlowState) => {
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
    let result: CreateRfqResult;
    try {
      result = await action(artworkId, body, key);
    } catch {
      result = {
        status: 'error' as const,
        code: 'SERVER_ERROR' as const,
        message: RFQ_MESSAGES.SERVER_ERROR,
      };
    }
    // Drop if unmounted or superseded by a newer attempt / makeAnother.
    if (!aliveRef.current || epoch !== epochRef.current) return;
    setState(
      result.status === 'success'
        ? { status: 'created', rfq: result.rfq }
        : { status: 'error', code: result.code, message: result.message },
    );
  }, [action, artworkId, setState]);

  const start = useCallback(
    (freshKey: boolean, input: RfqInput) => {
      if (busyRef.current) return; // single-flight
      busyRef.current = true;
      epochRef.current += 1;
      const epoch = epochRef.current;
      bodyRef.current = input; // freeze the body snapshot
      if (freshKey || !keyRef.current) keyRef.current = mintIdempotencyKey();
      setState({ status: 'submitting' });
      // Only release busyRef if THIS attempt is still current — a makeAnother/new submit that superseded us
      // (bumping the epoch, and possibly already re-acquiring busyRef) must keep its own latch.
      void run().finally(() => {
        if (aliveRef.current && epochRef.current === epoch) busyRef.current = false;
      });
    },
    [run, setState],
  );

  // New attempt → fresh key + fresh body snapshot.
  const submit = useCallback((input: RfqInput) => start(true, input), [start]);

  // Retry the frozen body with the SAME key, except mint a fresh key after a 422 MISMATCH.
  const retry = useCallback(() => {
    const s = stateRef.current;
    if (s.status !== 'error' || !bodyRef.current) return;
    start(s.code === 'IDEMPOTENCY_KEY_MISMATCH', bodyRef.current);
  }, [start]);

  // Reset for a new offer: clear the frozen key + body and bump the epoch so any in-flight response is dropped.
  // Also release busyRef — the epoch bump already neutralizes the orphaned resolve, and leaving busyRef set
  // would silently swallow the next submit (a fast reset-then-resubmit) until the orphaned request settled.
  const makeAnother = useCallback(() => {
    epochRef.current += 1;
    keyRef.current = null;
    bodyRef.current = null;
    busyRef.current = false;
    setState({ status: 'idle' });
  }, [setState]);

  return { state, submit, retry, makeAnother };
}
