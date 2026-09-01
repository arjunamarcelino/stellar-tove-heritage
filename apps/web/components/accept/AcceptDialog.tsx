'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useAcceptFlow } from '@/hooks/useAcceptFlow';
import { formatUsdc } from '@/lib/money/format';
import UiSpinner from '@/components/ui/Spinner';
import {
  ACCEPT_PRIMARY_BUTTON,
  ACCEPT_SECONDARY_BUTTON,
  MONEY_FIGURE,
} from '@/components/accept/constants';
import type { AcceptFlowState } from '@/hooks/useAcceptFlow';
import type { OpenQuote, Trade } from '@/lib/types/api';

// The accept confirmation dialog (TOV-178 / FR-06.04). Native <dialog> (showModal → free focus-trap + inert
// background), owning the useAcceptFlow ceremony. Mirrors WalletExportDialog's a11y: per-phase focus to the
// heading + ONE sr-only role="status" live region (distinct terse text, so opening announces the dialog via
// focus and phase changes announce via the region without double-speaking), and a LOCKED set that blocks
// Esc/backdrop dismissal while an irreversible step is in flight. The Accept click that mounts this is gesture 1
// (→ prepare); the Sign button is gesture 2 (→ passkey), so the assertion fires from a fresh user gesture.
//
// Remounted by React key per attempt (parent), so cancelledRef alone covers cancellation — see useAcceptFlow.

// Phases where the dialog must not be dismissed — an in-flight/unknown-outcome irreversible step.
const LOCKED = new Set<AcceptFlowState['status']>(['signing', 'submitting', 'reconciling']);

export default function AcceptDialog({
  rfqId,
  quote,
  onSubmitted,
  onStale,
  onClose,
}: {
  rfqId: string;
  quote: OpenQuote;
  onSubmitted: (trade: Trade) => void;
  onStale: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const startedRef = useRef(false);
  const { state, acceptQuote, sign, retry, reconcile } = useAcceptFlow();

  // Open the modal and kick off prepare once (gesture 1 = the Accept click that mounted this dialog).
  useEffect(() => {
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    if (!startedRef.current) {
      startedRef.current = true;
      void acceptQuote(rfqId, quote);
    }
  }, [acceptQuote, rfqId, quote]);

  // Move focus to the step heading on each transition (announce context before controls).
  useEffect(() => {
    headingRef.current?.focus();
  }, [state.status]);

  // Handoffs to the parent coordinator (never during render). Close the native <dialog> BEFORE the handoff so
  // the browser's focus-return fires while the node is still attached — otherwise the parent unmounts an
  // open <dialog> and focus silently drops to <body> (todo 184).
  useEffect(() => {
    if (state.status === 'submitted') {
      dialogRef.current?.close();
      onSubmitted(state.trade);
    } else if (state.status === 'staleQuote') {
      dialogRef.current?.close();
      onStale();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  const locked = LOCKED.has(state.status);

  function handleClose() {
    dialogRef.current?.close();
    onClose();
  }

  const errorCode = state.status === 'error' ? state.code : undefined;
  const tradeId = state.status === 'submitted' ? state.trade.tradeId : undefined;
  // Machine-readable recovery for the generic error state (derived from the hook's retry disposition, not a
  // table — todo 178/180).
  const errorAffordance =
    state.status === 'error' ? (state.retry !== 'none' ? 'retry' : 'dead-end') : undefined;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="accept-dialog-heading"
      data-accept-state={state.status}
      data-error-code={errorCode}
      data-affordance={errorAffordance}
      data-trade-id={tradeId}
      onCancel={(e) => {
        if (locked) e.preventDefault();
        else handleClose();
      }}
      className="m-auto w-full max-w-md rounded-md border border-charcoal/10 bg-bone p-6 text-umber backdrop:bg-ink/40"
    >
      <p className="sr-only" role="status" aria-live="polite">
        {state.status}
      </p>

      {(state.status === 'preparing' ||
        state.status === 'idle' ||
        state.status === 'reconciling') && (
        <Spinner headingRef={headingRef} title="Preparing your trade…" />
      )}

      {state.status === 'readyToSign' && (
        <div>
          <h2
            id="accept-dialog-heading"
            ref={headingRef}
            tabIndex={-1}
            className="font-heading text-lg text-umber outline-none"
          >
            Confirm &amp; sign
          </h2>
          <dl className="mt-4 space-y-2 text-sm text-charcoal">
            <Row
              label="You pay (gross)"
              value={`${formatUsdc(state.data.trade.grossStroops)} USDC`}
              strong
            />
            <Row label="Buyer fees" value="0 USDC" />
            <Row
              label="Seller receives (97%)"
              value={`${formatUsdc(state.data.trade.sellerNetStroops)} USDC`}
            />
            <Row
              label="Platform fee (1.5%)"
              value={`${formatUsdc(state.data.trade.platformFeeStroops)} USDC`}
            />
            <Row
              label="Artist royalty (1.5%)"
              value={`${formatUsdc(state.data.trade.artistRoyaltyStroops)} USDC`}
            />
          </dl>
          <div className="mt-6 space-y-2">
            <button
              type="button"
              className={ACCEPT_PRIMARY_BUTTON}
              data-requires-user-gesture
              onClick={() => void sign()}
            >
              Sign with passkey
            </button>
            <button type="button" className={ACCEPT_SECONDARY_BUTTON} onClick={handleClose}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {(state.status === 'signing' || state.status === 'submitting') && (
        <Spinner
          headingRef={headingRef}
          title={
            state.status === 'signing' ? 'Waiting for your passkey…' : 'Submitting your trade…'
          }
          note="Please keep this window open — closing it won’t reverse the trade."
        />
      )}

      {state.status === 'insufficientUsdc' && (
        <Terminal headingRef={headingRef} title="Not enough USDC">
          <p className="mt-2 text-sm text-charcoal">
            {state.required && state.available
              ? `You need ${formatUsdc(state.required)} USDC but have ${formatUsdc(state.available)}. `
              : ''}
            Add funds or choose a smaller quote.
          </p>
          <button type="button" className={`${ACCEPT_SECONDARY_BUTTON} mt-4`} onClick={handleClose}>
            Back to quotes
          </button>
        </Terminal>
      )}

      {state.status === 'notWhitelisted' && (
        <Terminal headingRef={headingRef} title="Verify your identity">
          <p className="mt-2 text-sm text-charcoal">
            Complete identity verification (KYC) to accept a quote.
          </p>
          <Link href={'/settings/kyc' as Route} className={`${ACCEPT_PRIMARY_BUTTON} mt-4`}>
            Complete KYC
          </Link>
        </Terminal>
      )}

      {state.status === 'sessionExpired' && (
        <Terminal headingRef={headingRef} title="Your session expired">
          <p className="mt-2 text-sm text-charcoal">Please sign in again to accept this quote.</p>
          <Link href={'/login' as Route} className={`${ACCEPT_PRIMARY_BUTTON} mt-4`}>
            Sign in
          </Link>
        </Terminal>
      )}

      {state.status === 'recheck' && (
        <Terminal headingRef={headingRef} title="We couldn’t confirm your trade">
          <p className="mt-2 text-sm text-charcoal">
            Your trade may still have gone through. Check again before retrying.
          </p>
          <div className="mt-4 space-y-2">
            <button
              type="button"
              className={ACCEPT_PRIMARY_BUTTON}
              onClick={() => void reconcile()}
            >
              Check again
            </button>
            <button type="button" className={ACCEPT_SECONDARY_BUTTON} onClick={handleClose}>
              Back to quotes
            </button>
          </div>
        </Terminal>
      )}

      {state.status === 'error' && (
        <Terminal headingRef={headingRef} title="That didn’t work">
          <p className="mt-2 text-sm text-charcoal">{state.message}</p>
          <div className="mt-4 space-y-2">
            {/* Retry-ability is the hook's `retry` disposition — the single source of truth. The codes that
                warrant a tailored (non-retry) affordance are already routed to dedicated states
                (notWhitelisted / insufficientUsdc / staleQuote / sessionExpired), so no error-code table is
                needed here (todo 178). */}
            {state.retry !== 'none' && (
              <button type="button" className={ACCEPT_PRIMARY_BUTTON} onClick={retry}>
                Try again
              </button>
            )}
            <button type="button" className={ACCEPT_SECONDARY_BUTTON} onClick={handleClose}>
              Back to quotes
            </button>
          </div>
        </Terminal>
      )}
    </dialog>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-charcoal/60">{label}</dt>
      <dd className={strong ? `text-base ${MONEY_FIGURE}` : 'text-charcoal'}>{value}</dd>
    </div>
  );
}

function Spinner({
  headingRef,
  title,
  note,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  title: string;
  note?: string;
}) {
  return (
    <div className="py-4 text-center">
      <UiSpinner className="border-charcoal/20 border-t-ochre" />
      <h2
        id="accept-dialog-heading"
        ref={headingRef}
        tabIndex={-1}
        className="mt-4 font-heading text-lg text-umber outline-none"
      >
        {title}
      </h2>
      {note && <p className="mt-2 text-sm text-charcoal/60">{note}</p>}
    </div>
  );
}

function Terminal({
  headingRef,
  title,
  children,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div role="alert">
      <h2
        id="accept-dialog-heading"
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-lg text-umber outline-none"
      >
        {title}
      </h2>
      {children}
    </div>
  );
}
