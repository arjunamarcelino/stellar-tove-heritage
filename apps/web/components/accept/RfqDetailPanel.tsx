'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { detectPasskeySupport } from '@/lib/webauthn/passkey';
import { rfqDetailAction } from '@/app/actions/accept';
import RfqContextSummary from '@/components/accept/RfqContextSummary';
import OpenQuotesList from '@/components/accept/OpenQuotesList';
import AcceptDialog from '@/components/accept/AcceptDialog';
import SettlementStatus from '@/components/accept/SettlementStatus';
import type { OpenQuote, RfqDetail, Trade } from '@/lib/types/api';

// The accept coordinator (TOV-178 / FR-06.04, WS-D). Owns the body-swap between three modes — list ↔
// ceremony(dialog) ↔ settlement — mirroring the OfferingPage precedent (a lifted `trade` + a pure mode
// derivation, no imperative reverse-handoff). The dialog and settlement panel are REMOUNTED by React key on
// attempt/trade identity (plan D3), so each gets a virgin hook and stale timers/refs can't leak across attempts.
//
// One trade per RFQ (AC-B): whenever a trade exists (pending/settled/failed) the list is REPLACED by the
// settlement panel — stronger than disabling the CTAs. A `failed`+stays-open outcome routes back to the list or
// re-opens the dialog for the same quote (a fresh idempotency key is minted by useAcceptFlow either way).

export default function RfqDetailPanel({
  rfqId,
  initialRfq,
  seedTrade,
}: {
  rfqId: string;
  initialRfq: RfqDetail;
  seedTrade: Trade | null;
}) {
  const [rfq, setRfq] = useState<RfqDetail>(initialRfq);
  const [trade, setTrade] = useState<Trade | null>(seedTrade);
  const [chosenQuote, setChosenQuote] = useState<OpenQuote | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [passkeySupported, setPasskeySupported] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Latest-wins guard for refreshRfq: a monotonic sequence id ignores any response that isn't the newest, so an
  // out-of-order resolution can't paint a stale quote list over a fresh one; cancelledRef blocks setState after
  // unmount (todo 176).
  const seqRef = useRef(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    let cancelled = false;
    void detectPasskeySupport().then((r) => {
      if (!cancelled) setPasskeySupported(r.supported);
    });
    return () => {
      cancelled = true;
      cancelledRef.current = true;
    };
  }, []);

  const refreshRfq = useCallback(async () => {
    const id = ++seqRef.current;
    setRefreshing(true);
    try {
      const res = await rfqDetailAction(rfqId);
      if (id !== seqRef.current || cancelledRef.current) return; // superseded by a newer refresh, or unmounted
      if (res.status === 'success') setRfq(res.rfq);
    } finally {
      if (id === seqRef.current && !cancelledRef.current) setRefreshing(false);
    }
  }, [rfqId]);

  const onAccept = useCallback((quote: OpenQuote) => {
    setChosenQuote(quote);
    setAttempt((a) => a + 1);
  }, []);

  // Dialog handoffs
  const onSubmitted = useCallback((t: Trade) => {
    setTrade(t); // pending → swaps to the settlement panel
  }, []);
  const onStale = useCallback(() => {
    setChosenQuote(null);
    void refreshRfq(); // the quote drifted — re-fetch the list
  }, [refreshRfq]);
  const onDialogClose = useCallback(() => setChosenQuote(null), []);

  // Settlement handoffs
  const onSettled = useCallback(() => {
    void refreshRfq(); // header → Accepted, rivals drop out (AC-A)
  }, [refreshRfq]);
  const onReAccept = useCallback(() => {
    // Same quote, fresh attempt (fresh key inside useAcceptFlow) — re-open the dialog.
    setTrade(null);
    setAttempt((a) => a + 1);
  }, []);
  const onAcceptAnother = useCallback(() => {
    setTrade(null);
    setChosenQuote(null);
    void refreshRfq();
  }, [refreshRfq]);

  return (
    <div
      className="flex flex-col gap-6"
      data-gate="pass"
      data-panel-mode={trade ? 'settlement' : chosenQuote ? 'ceremony' : 'list'}
    >
      <RfqContextSummary rfq={rfq} />

      {trade ? (
        <SettlementStatus
          key={trade.tradeId}
          rfqId={rfqId}
          seedTrade={trade}
          onSettled={onSettled}
          onReAccept={onReAccept}
          onAcceptAnother={onAcceptAnother}
        />
      ) : (
        <OpenQuotesList
          quotes={rfq.quotes}
          passkeySupported={passkeySupported}
          refreshing={refreshing}
          onAccept={onAccept}
          onRefresh={() => void refreshRfq()}
        />
      )}

      {!trade && chosenQuote && (
        <AcceptDialog
          key={attempt}
          rfqId={rfqId}
          quote={chosenQuote}
          onSubmitted={onSubmitted}
          onStale={onStale}
          onClose={onDialogClose}
        />
      )}
    </div>
  );
}
