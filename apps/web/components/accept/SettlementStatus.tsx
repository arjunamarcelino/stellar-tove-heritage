'use client';

import { useEffect, useRef } from 'react';
import { useTradePolling } from '@/hooks/useTradePolling';
import Spinner from '@/components/ui/Spinner';
import { explorerTxUrl } from '@/lib/wallet/format';
import { formatUsdc } from '@/lib/money/format';
import { FAILURE_REASON_COPY } from '@/lib/accept/acceptMessages';
import { failureAffordance } from '@/components/accept/affordance';
import {
  ACCEPT_PRIMARY_BUTTON,
  ACCEPT_SECONDARY_BUTTON,
  MONEY_FIGURE,
  MUTED_LINK,
} from '@/components/accept/constants';
import type { Trade } from '@/lib/types/api';

// The settlement panel (TOV-178 / FR-06.04). Owns useTradePolling (seeded with the pending trade handed off from
// the ceremony, or the SSR getMyTrade seed on a reload). Renders the terminal outcome: `settled` → receipt with
// the on-chain txHash (and signals the parent to re-read the RFQ so its header flips to "Accepted" — AC-A);
// `failed` → routed by the closed-set failureReason (accept-another / re-accept / alert); prolonged `pending` →
// a "still settling" hold (there is NO hard timeout). data-* hooks make the terminal outcome machine-readable.

export default function SettlementStatus({
  rfqId,
  seedTrade,
  onSettled,
  onReAccept,
  onAcceptAnother,
}: {
  rfqId: string;
  seedTrade: Trade | null;
  onSettled: () => void;
  onReAccept: () => void;
  onAcceptAnother: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { trade, phase, refresh } = useTradePolling(rfqId, seedTrade);

  useEffect(() => {
    headingRef.current?.focus();
  }, [phase]);

  // On settled, ask the parent to re-read the RFQ once (header → Accepted, rivals drop out).
  useEffect(() => {
    if (phase === 'settled') onSettled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const affordance = phase === 'failed' ? failureAffordance(trade?.failureReason ?? null) : null;

  return (
    <section
      aria-labelledby="settlement-heading"
      data-trade-status={trade?.status}
      data-poll-phase={phase}
      data-trade-id={trade?.tradeId}
      data-failure-reason={phase === 'failed' ? (trade?.failureReason ?? 'unknown') : undefined}
      data-affordance={affordance?.kind}
      data-tx-hash={phase === 'settled' ? (trade?.txHash ?? undefined) : undefined}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {phase}
      </p>

      {(phase === 'idle' || phase === 'polling') && (
        <div className="py-6 text-center">
          <Spinner className="border-charcoal/20 border-t-ochre" />
          <h2
            id="settlement-heading"
            ref={headingRef}
            tabIndex={-1}
            className="mt-4 font-heading text-lg text-umber outline-none"
          >
            Settling your trade…
          </h2>
          <p className="mt-2 text-sm text-charcoal/60">
            This can take up to a few minutes. You can safely leave this page — we’ll keep it up to
            date.
          </p>
          {trade && (
            <p className={`mt-3 text-sm ${MONEY_FIGURE}`}>
              {trade.count} fractions · {formatUsdc(trade.grossStroops)} USDC
            </p>
          )}
        </div>
      )}

      {phase === 'settled' && (
        <div className="py-2 text-center">
          <h2
            id="settlement-heading"
            ref={headingRef}
            tabIndex={-1}
            className="font-heading text-lg text-umber outline-none"
          >
            Trade complete
          </h2>
          <p className="mt-2 text-sm text-charcoal">
            You accepted {trade?.count} fractions for {trade ? formatUsdc(trade.grossStroops) : ''}{' '}
            USDC.
          </p>
          {trade?.txHash && (
            <a
              href={explorerTxUrl(trade.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-3 inline-block ${MUTED_LINK}`}
            >
              View settlement on-chain ↗
            </a>
          )}
        </div>
      )}

      {phase === 'failed' && affordance && (
        <div className="py-2 text-center" role="alert">
          <h2
            id="settlement-heading"
            ref={headingRef}
            tabIndex={-1}
            className="font-heading text-lg text-umber outline-none"
          >
            Trade didn’t settle
          </h2>
          <p className="mt-2 text-sm text-charcoal">
            {FAILURE_REASON_COPY[trade?.failureReason ?? 'unknown']}
          </p>
          <div className="mt-4 flex flex-col items-center gap-2">
            {affordance.kind === 'accept-another' && (
              <button type="button" className={ACCEPT_PRIMARY_BUTTON} onClick={onAcceptAnother}>
                Accept a different quote
              </button>
            )}
            {affordance.kind === 're-accept' && (
              <button type="button" className={ACCEPT_PRIMARY_BUTTON} onClick={onReAccept}>
                Try accepting again
              </button>
            )}
            {affordance.kind === 'alert' && (
              <button type="button" className={ACCEPT_SECONDARY_BUTTON} onClick={onAcceptAnother}>
                Back to quotes
              </button>
            )}
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="py-4 text-center" role="alert">
          <h2
            id="settlement-heading"
            ref={headingRef}
            tabIndex={-1}
            className="font-heading text-lg text-umber outline-none"
          >
            We lost track of your trade
          </h2>
          <p className="mt-2 text-sm text-charcoal">
            We couldn’t reach the server to check settlement. Your trade may still be processing.
          </p>
          <button type="button" className={`${ACCEPT_PRIMARY_BUTTON} mt-4`} onClick={refresh}>
            Check again
          </button>
        </div>
      )}
    </section>
  );
}
