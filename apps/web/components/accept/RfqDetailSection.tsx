import Link from 'next/link';
import type { Route } from 'next';
import { rfqDetailGateVerdict } from '@/lib/accept/status';
import { TONE_CARD_BASE, TONE_NEUTRAL } from '@/components/ui/surfaces';
import { ACCEPT_PRIMARY_BUTTON } from '@/components/accept/constants';
import RfqDetailPanel from '@/components/accept/RfqDetailPanel';
import RetryButton from '@/components/ui/RetryButton';
import type { RfqDetailResult, Trade } from '@/lib/types/api';

// The accept surface's Server Component dispatcher (TOV-178 / FR-06.04). Only RfqDetailPanel (and below) is
// 'use client'. Computes the gate verdict from the viewer's signed-in state + the SSR RFQ-detail read, then
// dispatches: sign-in gate | not-found | neutral load-error retry | the accept panel (seeded with the RFQ +
// the SSR getMyTrade result so a reload mid-settlement resumes the poll — AC-C).

export default function RfqDetailSection({
  rfqId,
  isSignedIn,
  result,
  seedTrade,
}: {
  rfqId: string;
  isSignedIn: boolean;
  result: RfqDetailResult;
  seedTrade: Trade | null;
}) {
  const verdict = rfqDetailGateVerdict({ isSignedIn, result });

  if (verdict.kind === 'gate') {
    return (
      <div className={`${TONE_CARD_BASE} ${TONE_NEUTRAL} flex-col`} data-gate="sign-in">
        <p className="text-current/80">Sign in to review and accept quotes on your request.</p>
        <Link href={'/login' as Route} className={`${ACCEPT_PRIMARY_BUTTON} mt-2 self-start`}>
          Sign in
        </Link>
      </div>
    );
  }

  if (verdict.kind === 'not-found') {
    return (
      <div className={`${TONE_CARD_BASE} ${TONE_NEUTRAL} flex-col`} data-gate="not-found">
        <p className="text-current/80">
          We couldn’t find this request, or it isn’t yours. Only the buyer who created a request can
          accept quotes on it.
        </p>
      </div>
    );
  }

  if (verdict.kind === 'load-error') {
    return (
      <div className={`${TONE_CARD_BASE} ${TONE_NEUTRAL} flex-col`} data-gate="read-failed">
        <p className="text-current/80">
          We couldn’t load your request just now. Please refresh and try again.
        </p>
        <RetryButton />
      </div>
    );
  }

  // verdict.kind === 'panel' — narrowing guarantees a success result.
  if (result.status !== 'success') return null;
  return <RfqDetailPanel rfqId={rfqId} initialRfq={result.rfq} seedTrade={seedTrade} />;
}
