import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { COOKIE_KEYS, SITE_CONFIG } from '@/lib/constants';
import { getHoldings } from '@/lib/services/holdings';
import HoldingsWidget from '@/components/dashboard/HoldingsWidget';
import HoldingsSkeleton from '@/components/dashboard/HoldingsSkeleton';

export const metadata: Metadata = {
  title: `Dashboard — ${SITE_CONFIG.name}`,
};

// Async Server Component: awaits getHoldings INSIDE the Suspense boundary so the skeleton streams on first
// paint while the dashboard shell renders. MUST stay server-only (no 'use client') — `token` is a
// server→server prop and never crosses the client boundary.
// Exported for unit testing the SSR SESSION_EXPIRED redirect branch (it's a non-page async child, so it
// never executes when DashboardPage() is called directly). Next ignores non-reserved named exports.
export async function HoldingsSection({ token }: { token: string }) {
  const initial = await getHoldings(token);
  // A stale-but-present cookie surfaces as SESSION_EXPIRED at SSR → send to login (auth-gate parity). Because
  // this fires after the skeleton has streamed, it resolves as a client-side redirect — acceptable; the
  // pre-stream cookie-presence gate below stays a real HTTP redirect.
  if (initial.status === 'error' && initial.code === 'SESSION_EXPIRED') redirect('/login');
  return <HoldingsWidget initial={initial} />;
}

export default async function DashboardPage() {
  // Auth gate (parity with /settings): the (main) layout only renders chrome, so protected pages gate
  // themselves. The handle commit redirects here, so an unauthenticated direct hit must not render.
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_KEYS.accessToken)?.value;
  if (!token) redirect('/login');

  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-heading text-3xl text-charcoal">Dashboard</h1>
      <div className="mt-10">
        <Suspense fallback={<HoldingsSkeleton />}>
          <HoldingsSection token={token} />
        </Suspense>
      </div>
    </section>
  );
}
