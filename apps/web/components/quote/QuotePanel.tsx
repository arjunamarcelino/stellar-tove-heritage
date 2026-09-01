'use client';

import Link from 'next/link';
import { useEffect, useRef, type ReactElement } from 'react';
import { useSubmitQuote, type QuoteFlowState } from '@/hooks/useSubmitQuote';
import { submitQuoteAction } from '@/app/actions/quotes';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '@/components/ui/buttons';
import { ERROR_CLASS, TONE_CARD_BASE, TONE_NEUTRAL } from '@/components/ui/surfaces';
import { QUOTE_AFFORDANCE } from './affordance';
import QuoteForm from './QuoteForm';
import QuoteConfirmation from './QuoteConfirmation';
import QuoteGateCta from './QuoteGateCta';

// The quote submission panel (TOV-176 / FR-06.03). Owns the useSubmitQuote state machine and, as the PAGE BODY
// (this route IS the surface — no collapse/expand), dispatches: form (disabled while submitting) → confirmation
// on 201 → inline error routed by QUOTE_AFFORDANCE otherwise. Accessibility (C8/R5.1): the multi-second
// balance-gate wait is announced in a polite `role="status"` region with NO focus move; on a terminal ERROR
// focus moves to the error container (which carries NO `role="alert"` — focus replaces the live announcement to
// avoid a double-read); the IDEMPOTENCY_KEY_IN_FLIGHT advisory is a polite region (no focus steal).
// Cross-reload dedup is guaranteed by the backend's 1-open-per-RFQ invariant + idempotency.

type ErrorState = Extract<QuoteFlowState, { status: 'error' }>;

// Shared retry control for the transient-error arms (the polite in-flight advisory and the focus-managed
// retry card use different wrappers but the same button).
function TryAgainButton({ onRetry }: { onRetry: () => void }) {
  return (
    <button type="button" onClick={onRetry} className={`${SECONDARY_BUTTON} mt-2 self-start`}>
      Try again
    </button>
  );
}

// NOTE: no `role="alert"` on any arm — this whole subtree is rendered inside the focus-managed container, and
// focusing it announces the content. A live role here would DOUBLE-announce (C8/R5.1).
function ErrorAffordanceView({
  state,
  onRetry,
}: {
  state: ErrorState;
  onRetry: () => void;
}): ReactElement {
  const affordance = QUOTE_AFFORDANCE[state.code];
  switch (affordance.kind) {
    case 'sign-in':
      return (
        <div className={`${TONE_CARD_BASE} ${TONE_NEUTRAL} flex-col`}>
          <p className="text-current/80">{state.message}</p>
          <Link href="/login" className={`${PRIMARY_BUTTON} mt-2 self-start`}>
            Sign in
          </Link>
        </div>
      );
    case 'gate':
      return <QuoteGateCta reason={affordance.reason} />;
    case 'wallet-setup':
      return (
        <div className={`${TONE_CARD_BASE} ${TONE_NEUTRAL} flex-col`}>
          <p className="text-current/80">{state.message}</p>
          <Link href="/settings" className={`${PRIMARY_BUTTON} mt-2 self-start`}>
            Set up a wallet
          </Link>
        </div>
      );
    case 'inline-balance': {
      // The form stays live above; recovery is the form's own submit() (fresh key, C2) — no retry button here.
      const detail =
        state.code === 'QUOTE_INSUFFICIENT_FREE_BALANCE' ? state.balanceDetail : undefined;
      return (
        <div className={ERROR_CLASS}>
          <p>{state.message}</p>
          {detail ? (
            <p className="mt-1">
              You asked to sell {detail.requiredFractionCount} but only {detail.freeFractionCount}{' '}
              are free right now. Lower the amount and submit again.
            </p>
          ) : null}
        </div>
      );
    }
    case 'dead-end':
      // Deterministic — a same-body retry re-fails. Informative message + an escape link (C3/C6).
      return (
        <div className={`${ERROR_CLASS} flex flex-col gap-2`}>
          <p>{state.message}</p>
          <Link href="/dashboard" className={`${SECONDARY_BUTTON} self-start`}>
            Back to dashboard
          </Link>
        </div>
      );
    case 'retry':
      return (
        <div className={ERROR_CLASS}>
          <p>{state.message}</p>
          <TryAgainButton onRetry={onRetry} />
        </div>
      );
    default: {
      // Exhaustiveness guard: a new ErrorAffordance kind fails to compile here until it's handled.
      const _exhaustive: never = affordance;
      return _exhaustive;
    }
  }
}

export default function QuotePanel({ rfqId }: { rfqId: string }) {
  const { state, submit, retry, reset } = useSubmitQuote(rfqId, submitQuoteAction);
  const submitting = state.status === 'submitting';
  const isError = state.status === 'error';
  const errorCode = state.status === 'error' ? state.code : null;
  const isInFlight = errorCode === 'IDEMPOTENCY_KEY_IN_FLIGHT';

  // C8/R5.1: move focus to the error container on a terminal error — EXCEPT the polite in-flight advisory. No
  // role="alert" on that container (the focus move announces it; doubling would re-read).
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isError && !isInFlight) errorRef.current?.focus();
  }, [isError, isInFlight, errorCode]);

  return (
    // Machine-readable state hooks for DOM-driving agents/AT (parity is via submitQuoteAction; these expose
    // the resulting state without disturbing the AT focus/live-region contract).
    <div
      className="flex flex-col gap-4"
      data-quote-state={state.status}
      data-error-code={errorCode ?? undefined}
    >
      {state.status === 'created' ? (
        <QuoteConfirmation quote={state.quote} onSubmitAnother={reset} />
      ) : (
        <>
          <div aria-busy={submitting || undefined}>
            <QuoteForm autoFocus disabled={submitting} onSubmit={submit} />
          </div>

          {/* Pending: the multi-second live balance-gate read — polite, NO focus (C8/SC 4.1.3). */}
          {submitting ? (
            <p role="status" aria-live="polite" className={`${TONE_CARD_BASE} ${TONE_NEUTRAL}`}>
              Checking your fraction balance…
            </p>
          ) : null}

          {/* IN_FLIGHT: a polite advisory that keeps the form usable — no focus steal. */}
          {state.status === 'error' && isInFlight ? (
            <div
              role="status"
              aria-live="polite"
              className={`${TONE_CARD_BASE} ${TONE_NEUTRAL} flex-col`}
            >
              <p className="text-current/80">{state.message}</p>
              <TryAgainButton onRetry={retry} />
            </div>
          ) : null}

          {/* Every other terminal error: focus-managed container, NO live role (focus replaces the announcement). */}
          {state.status === 'error' && !isInFlight ? (
            <div ref={errorRef} tabIndex={-1} className="outline-none">
              <ErrorAffordanceView state={state} onRetry={retry} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
