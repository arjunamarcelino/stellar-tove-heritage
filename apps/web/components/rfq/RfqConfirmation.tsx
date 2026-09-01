'use client';

import { useEffect, useRef } from 'react';
import { formatUsdc } from '@/lib/money/format';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '@/components/ui/buttons';
import { TONE_CARD_BASE, TONE_WARNING } from '@/components/ui/surfaces';
import { MONEY_FIGURE } from '@/components/ui/typography';
import RfqCountdown from './RfqCountdown';
import type { Rfq } from '@/lib/types/api';

// The RFQ create confirmation (TOV-173 / FR-06.01). Static parent: the ticking countdown lives in the
// RfqCountdown leaf so this subtree doesn't re-render each second. On mount, focus moves to the heading (a
// clear "you are here" landing) — NOT wrapped in a live region (that would double-announce). The optional
// balance hint is advisory only (role="status", polite) and NEVER implies solvency when absent (P8). No
// fund-movement language: amounts are a ceiling of intent, never "you pay"/"escrow".

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export default function RfqConfirmation({
  rfq,
  onMakeAnother,
  onDone,
}: {
  rfq: Rfq;
  onMakeAnother: () => void;
  onDone: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const warning = rfq.balanceWarning;

  return (
    <div className="flex flex-col gap-3">
      <h3 ref={headingRef} tabIndex={-1} className="font-heading text-lg text-umber outline-none">
        Offer created
      </h3>
      <dl className="flex flex-col gap-1 text-sm text-charcoal">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-charcoal/60">Offer ID</dt>
          <dd className={MONEY_FIGURE}>#{shortId(rfq.id)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-charcoal/60">Max per fraction</dt>
          <dd className={MONEY_FIGURE}>{formatUsdc(rfq.maxPricePerFractionStroops)} USDC</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-charcoal/60">Fractions</dt>
          <dd className={MONEY_FIGURE}>{rfq.fractionCount}</dd>
        </div>
      </dl>

      <RfqCountdown expiresAt={rfq.expiresAt} />

      {warning ? (
        <p role="status" className={`${TONE_CARD_BASE} ${TONE_WARNING}`}>
          Heads up — this could need up to{' '}
          <span className={MONEY_FIGURE}>{formatUsdc(warning.requiredStroops)}</span> USDC; your
          wallet shows <span className={MONEY_FIGURE}>{formatUsdc(warning.availableStroops)}</span>{' '}
          USDC. Your offer was still created.
        </p>
      ) : null}

      <div className="mt-1 flex gap-3">
        <button type="button" onClick={onMakeAnother} className={PRIMARY_BUTTON}>
          Make another
        </button>
        <button type="button" onClick={onDone} className={SECONDARY_BUTTON}>
          Done
        </button>
      </div>
    </div>
  );
}
