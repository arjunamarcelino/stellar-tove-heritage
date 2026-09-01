import type { Metadata } from 'next';
import { readAccessToken } from '@/lib/cookies';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { z } from 'zod/v4';
import { SITE_CONFIG } from '@/lib/constants';
import { getActiveOffering, getMyBid } from '@/lib/services/offerings';
import { getWhitelistStatus } from '@/lib/services/kyc';
import OfferingPage from '@/components/offering/OfferingPage';
import OfferingSkeleton from '@/components/offering/OfferingSkeleton';
import RfqSection from '@/components/rfq/RfqSection';

// Public Offering subscription page (TOV-157 / FR-05.03). Anonymous-visible (view-only); a whitelisted,
// signed-in collector can bid. Reading the optional cookie makes the route dynamic (streaming, not PPR).
// `params` is a Promise in Next 16 — awaited below.
type PageParams = { params: Promise<{ id: string }> };

// The route `[id]` is an ARTWORK id; the bid endpoints key by OFFERING id. The offering id is resolved
// server-side (getActiveOffering) and flows to the client as a prop — no component derives it from the URL.
const idSchema = z.uuid();

// Thrown here (not in the server-only service) on a transient/malformed read → app/error.tsx (which offers a
// reset). Static message — never interpolate backend detail. A genuine "offering doesn't exist" uses
// notFound() instead, so a transient blip never renders as "no offering" (AC-21).
export class OfferingLoadError extends Error {
  constructor() {
    super('Failed to load offering');
    this.name = 'OfferingLoadError';
  }
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return { title: SITE_CONFIG.name };
  return { title: `Offering — ${SITE_CONFIG.name}` };
}

// Async section streamed inside the Suspense boundary. Exported for unit-testing the SSR branches (it never
// runs when the default page is called directly). Stays server-only — `token` is a server→server prop.
export async function OfferingSection({ id, token }: { id: string; token: string | null }) {
  // Whitelist depends only on the token, so fire it CONCURRENTLY with the offering resolve (todo 150) — it no
  // longer sits behind getActiveOffering on the critical path. getMyBid needs offering.id, so it waits.
  // getWhitelistStatus never rejects (returns a result union), so leaving it in flight across a notFound()/throw
  // on a 404 offering is harmless (at worst one wasted authed call for a signed-in user hitting a dead link).
  const whitelistPromise = token ? getWhitelistStatus(token) : Promise.resolve(null);

  // Resolve artwork → its single active offering (OPEN DEP #2). Not-found → the static 404; a transient read
  // → app/error.tsx (distinct from not-found so a backend blip isn't shown as "no offering").
  // COUPLING (TOV-173, review todo 161): this notFound() also gates the RFQ surface mounted below — a
  // fractionalized artwork with NO active primary offering 404s here and shows no "Make an offer" CTA, even
  // though RFQ is conceptually offering-window-independent. Accepted interim (this is the only artwork route
  // today); the FR-06.02 exit is a standalone /artworks/[id]/marketplace route. See the solutions doc RISK-4.
  const offeringResult = await getActiveOffering(id);
  if (offeringResult.status === 'error') {
    if (offeringResult.code === 'OFFERING_NOT_FOUND') notFound();
    throw new OfferingLoadError();
  }
  const { offering } = offeringResult;

  const [whitelist, myBid] = await Promise.all([
    whitelistPromise,
    token ? getMyBid(token, offering.id) : Promise.resolve(null),
  ]);

  // A stale token surfaces as SESSION_EXPIRED on the per-user reads. This is a PUBLIC page — degrade to
  // view-only (treat as not-signed-in) rather than redirect (architecture F14).
  const sessionStale =
    (whitelist?.status === 'error' && whitelist.code === 'SESSION_EXPIRED') ||
    (myBid?.status === 'error' && myBid.code === 'SESSION_EXPIRED');
  const isSignedIn = token != null && !sessionStale;
  const isWhitelisted = whitelist?.status === 'success' && whitelist.data.status === 'whitelisted';
  const initialBid = myBid?.status === 'success' ? myBid.bid : null;

  // Seed the gate with a PURE status-only coarse state (no clock read — reading time during render is
  // impure and hydration-unsafe). `opened` seeds conservatively to 'coming-soon'; OfferingPage refines the
  // real window state client-side per-second from the timestamps (the seed is used on the first client
  // render too, so there is no hydration mismatch).
  const initialUiState =
    offering.status === 'canceled'
      ? 'canceled'
      : offering.status === 'subscribed' || offering.status === 'settled'
        ? 'closed'
        : 'coming-soon';

  return (
    <div className="flex flex-col gap-[var(--spacing-section)]">
      <OfferingPage
        offering={offering}
        initialUiState={initialUiState}
        initialBid={initialBid}
        isWhitelisted={isWhitelisted}
        isSignedIn={isSignedIn}
      />
      {/* Secondary-market RFQ create (TOV-173). Its GATE LADDER is offering-window-independent, but its
          VISIBILITY is currently gated by the active-offering notFound() above (see the COUPLING note there;
          review todo 161). Reuses the already-computed gate state. No `fractionalized` flag on the offering
          payload yet (DEP-2) → render-and-error default. */}
      <RfqSection artworkId={id} isSignedIn={isSignedIn} isWhitelisted={isWhitelisted} />
    </div>
  );
}

export default async function OfferingSubscriptionPage({ params }: PageParams) {
  const { id } = await params; // Next 16: params is a Promise
  if (!idSchema.safeParse(id).success) notFound(); // SEC-1: reject a malformed id before any fetch

  const token = await readAccessToken();

  return (
    <section className="mx-auto w-full max-w-2xl px-[var(--spacing-gutter)] py-[var(--spacing-section)]">
      <Suspense fallback={<OfferingSkeleton />}>
        <OfferingSection id={id} token={token} />
      </Suspense>
    </section>
  );
}
