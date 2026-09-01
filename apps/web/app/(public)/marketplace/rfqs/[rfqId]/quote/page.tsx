import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod/v4';
import { SITE_CONFIG } from '@/lib/constants';
import { readAccessToken } from '@/lib/cookies';
import { getWhitelistStatus } from '@/lib/services/kyc';
import QuoteSection from '@/components/quote/QuoteSection';

// Quote submission route (TOV-176 / FR-06.03). A whitelisted holder responds to an open RFQ with a sell offer.
// Lives under (public) — matching the offering page's anon-degrade precedent; there is NO auth middleware
// (Next 16 renamed middleware.ts → proxy.ts, which is CSP-only), so an anonymous visitor renders the in-page
// sign-in gate rather than being redirected. Reading the cookie + params makes this route dynamic. `params` is a
// Promise in Next 16 — awaited below. The economic RFQ context (artwork, ask, quantity) is NOT read here: no
// RFQ-read endpoint yet, and untrusted deep-link params are deferred to FR-06.02 (C5). Only the authoritative
// rfqId flows to the client.
type PageParams = { params: Promise<{ rfqId: string }> };

const idSchema = z.uuid();

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { rfqId } = await params;
  if (!idSchema.safeParse(rfqId).success) return { title: SITE_CONFIG.name };
  return { title: `Submit a quote — ${SITE_CONFIG.name}` };
}

export default async function QuotePage({ params }: PageParams) {
  const { rfqId } = await params;
  // A malformed route segment is a hard 404 (the id can't address any RFQ). The action/service re-guard it.
  if (!idSchema.safeParse(rfqId).success) notFound();

  const token = await readAccessToken();
  const whitelist = token ? await getWhitelistStatus(token) : null;

  // A stale token surfaces as SESSION_EXPIRED — degrade to anon (sign-in gate), not a redirect (public page).
  const sessionStale = whitelist?.status === 'error' && whitelist.code === 'SESSION_EXPIRED';
  // Any OTHER whitelist-read error (5xx / timeout) → the neutral load-error state, NEVER the KYC gate (C7).
  const readFailed = whitelist?.status === 'error' && !sessionStale;
  const isSignedIn = token != null && !sessionStale;
  const isWhitelisted = whitelist?.status === 'success' && whitelist.data.status === 'whitelisted';

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-12 sm:py-16">
      <QuoteSection
        rfqId={rfqId}
        isSignedIn={isSignedIn}
        isWhitelisted={isWhitelisted}
        readFailed={readFailed}
      />
    </main>
  );
}
