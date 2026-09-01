'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useCreateRfq, type RfqFlowState } from '@/hooks/useCreateRfq';
import { createRfqAction } from '@/app/actions/rfqs';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '@/components/ui/buttons';
import { ERROR_CLASS, TONE_CARD_BASE, TONE_NEUTRAL } from '@/components/ui/surfaces';
import { RFQ_AFFORDANCE } from './affordance';
import RfqForm from './RfqForm';
import RfqConfirmation from './RfqConfirmation';
import RfqGateCta from './RfqGateCta';

type RfqErrorState = Extract<RfqFlowState, { status: 'error' }>;

// Table-driven error routing (TOV-176 backport). Behaviour is identical to the previous inline ladder — the
// same roles ("alert" for terminal, "status" for the polite in-flight advisory), the same affordances, and
// the same retry policy — but a new RfqErrorCode now fails to compile until routed in RFQ_AFFORDANCE.
function RfqErrorAffordanceView({
  state,
  onRetry,
}: {
  state: RfqErrorState;
  onRetry: () => void;
}): ReactElement {
  const affordance = RFQ_AFFORDANCE[state.code];
  switch (affordance.kind) {
    case 'sign-in':
      return (
        <div role="alert" className={`${TONE_CARD_BASE} ${TONE_NEUTRAL} flex-col`}>
          <p className="text-current/80">{state.message}</p>
          <Link href={'/login' as Route} className={`${PRIMARY_BUTTON} mt-2 self-start`}>
            Sign in
          </Link>
        </div>
      );
    case 'gate':
      // Backstop — the gate normally prevents this; a KYC affordance, not a re-failing "Try again".
      return <RfqGateCta reason={affordance.reason} />;
    case 'in-flight':
      return (
        <div role="status" className={`${TONE_CARD_BASE} ${TONE_NEUTRAL} flex-col`}>
          <p className="text-current/80">{state.message}</p>
          <button type="button" onClick={onRetry} className={`${SECONDARY_BUTTON} mt-2 self-start`}>
            Try again
          </button>
        </div>
      );
    case 'dead-end':
      // Deterministic eligibility error: a retry with the same body re-fails, so no "Try again".
      return (
        <div role="alert" className={ERROR_CLASS}>
          <p>{state.message}</p>
        </div>
      );
    case 'retry':
      // Transient / generic failures — a same-key retry can succeed.
      return (
        <div role="alert" className={ERROR_CLASS}>
          <p>{state.message}</p>
          <button type="button" onClick={onRetry} className={`${SECONDARY_BUTTON} mt-2 self-start`}>
            Try again
          </button>
        </div>
      );
    default: {
      const _exhaustive: never = affordance;
      return _exhaustive;
    }
  }
}

// The RFQ create panel (TOV-173 / FR-06.01, WS-D). A collapsed "Make an offer ▸" disclosure that expands the
// form inline. Owns the useCreateRfq state machine and dispatches: form (disabled while submitting) →
// confirmation on 201 → inline error otherwise. Focus moves into the form on expand and returns to the trigger
// on collapse (WCAG 2.4.3). A SESSION_EXPIRED / terminal error is an alert with a retry/sign-in affordance; a
// 409 IN_FLIGHT is a polite advisory. The form stays mounted through an error so entered values survive.

const PANEL_BODY_ID = 'rfq-panel-body';

export default function RfqPanel({ artworkId }: { artworkId: string }) {
  const { state, submit, retry, makeAnother } = useCreateRfq(artworkId, createRfqAction);
  const [expanded, setExpanded] = useState(false);
  const ctaRef = useRef<HTMLButtonElement>(null);
  // The trigger button only exists in the collapsed branch, so it can't be focused synchronously inside
  // collapse() (the ref is null while expanded). Latch the intent and focus it from an effect once the
  // collapsed branch has re-mounted the button (WCAG 2.4.3 focus-return).
  const returnFocusRef = useRef(false);

  const collapse = () => {
    makeAnother(); // reset the machine back to idle
    returnFocusRef.current = true;
    setExpanded(false);
  };

  useEffect(() => {
    if (!expanded && returnFocusRef.current) {
      returnFocusRef.current = false;
      ctaRef.current?.focus();
    }
  }, [expanded]);

  if (!expanded) {
    return (
      <button
        ref={ctaRef}
        type="button"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
        aria-controls={PANEL_BODY_ID}
        className={`${PRIMARY_BUTTON} self-start`}
      >
        Make an offer
      </button>
    );
  }

  const submitting = state.status === 'submitting';

  return (
    <div id={PANEL_BODY_ID} className="flex flex-col gap-4">
      {state.status === 'created' ? (
        <RfqConfirmation rfq={state.rfq} onMakeAnother={makeAnother} onDone={collapse} />
      ) : (
        <>
          <RfqForm autoFocus disabled={submitting} onSubmit={submit} />

          {state.status === 'error' ? (
            <RfqErrorAffordanceView state={state} onRetry={retry} />
          ) : null}

          {/* Disabled while submitting so an in-flight create can't be abandoned (which would drop a
              possibly-created RFQ and clear the idempotency key → a duplicate on resubmit). */}
          <button
            type="button"
            onClick={collapse}
            disabled={submitting}
            className="self-start text-sm text-sienna underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
        </>
      )}
    </div>
  );
}
