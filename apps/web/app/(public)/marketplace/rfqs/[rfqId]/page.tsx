import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod/v4';
import { SITE_CONFIG } from '@/lib/constants';
import { readAccessToken } from '@/lib/cookies';
import { getRfqDetail, getMyTrade } from '@/lib/services/accept';
import RfqDetailSection from '@/components/accept/RfqDetailSection';
import type { RfqDetailResult } from '@/lib/types/api';

// Quote-acceptance route (TOV-178 / FR-06.04). The RFQ creator reviews the open quotes on their request and
// accepts one via a passkey ceremony (settlement is async → poll). Lives under (public) — there is NO auth
// middleware (Next 16 renamed middleware.ts → proxy.ts, CSP-only), so an anonymous visitor renders the in-page
// sign-in gate rather than being redirected. `params` is a Promise in Next 16 — awaited below. SSR-SEED: the
// RFQ detail (list + gate) AND the caller's latest trade (getMyTrade) are read in parallel, so a reload
// mid-settlement resumes the poll from the seed (AC-C). The RFQ read is owner-scoped (a non-creator gets 404).
type PageParams = { params: Promise<{ rfqId: string }> };

const idSchema = z.uuid();

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { rfqId } = await params;
  if (!idSchema.safeParse(rfqId).success) return { title: SITE_CONFIG.name };
  return { title: `Accept a quote — ${SITE_CONFIG.name}` };
}

export default async function RfqAcceptPage({ params }: PageParams) {
  const { rfqId } = await params;
  // A malformed route segment is a hard 404 (the id can't address any RFQ). The action/service re-guard it.
  if (!idSchema.safeParse(rfqId).success) notFound();

  const token = await readAccessToken();

  // Anonymous → the in-page sign-in gate (a synthetic session-expired result routes the verdict to 'gate').
  if (!token) {
    const anon: RfqDetailResult = {
      status: 'error',
      code: 'SESSION_EXPIRED',
      message: '',
    };
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-12 sm:py-16">
        <RfqDetailSection rfqId={rfqId} isSignedIn={false} result={anon} seedTrade={null} />
      </main>
    );
  }

  // SSR seed: both reads key on rfqId alone, so they parallelize. A getMyTrade 404/empty maps to trade:null in
  // the service (the normal "no trade yet" state — never a page error).
  const [result, tradeResult] = await Promise.all([
    getRfqDetail(token, rfqId),
    getMyTrade(token, rfqId),
  ]);
  const seedTrade = tradeResult.status === 'success' ? tradeResult.trade : null;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12 sm:py-16">
      <RfqDetailSection rfqId={rfqId} isSignedIn result={result} seedTrade={seedTrade} />
    </main>
  );
}
