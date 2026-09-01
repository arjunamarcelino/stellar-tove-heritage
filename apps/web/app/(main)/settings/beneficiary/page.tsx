import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_KEYS, SITE_CONFIG } from '@/lib/constants';
import { getBeneficiary } from '@/lib/services/beneficiary';
import BeneficiarySettings from '@/components/beneficiary/BeneficiarySettings';
import { ERROR_CLASS, MUTED_LINK } from '@/components/ui/surfaces';

export const metadata: Metadata = {
  title: `Beneficiary — ${SITE_CONFIG.name}`,
  // Auth-gated PII surface (a third party's details) — keep it out of the index.
  robots: { index: false, follow: false },
};

// Auth-gated Server Component (TOV-46 / FR-01.10). The settings layout does NOT gate auth, so this page reads
// the httpOnly cookie itself and redirect('/login') on a miss. It SSR-reads the single beneficiary and hands
// it to the client orchestrator. On a read failure it renders a BLOCKING error (not an empty editable form —
// saving off a failed read would fabricate a full-replace); a 401 redirects to sign in. GET never 404s: an
// empty state is `beneficiary: null`.
export default async function BeneficiaryPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_KEYS.accessToken)?.value;
  if (!token) redirect('/login');

  const result = await getBeneficiary(token);

  if (result.status === 'error') {
    if (result.code === 'SESSION_EXPIRED') redirect('/login');
    return (
      <section className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="font-heading text-3xl text-charcoal">Beneficiary</h1>
        <p className={`mt-6 ${ERROR_CLASS}`} role="alert">
          {result.message}
        </p>
        {/* A plain link re-runs the Server Component read — no stale client state to reconcile. */}
        <a href="/settings/beneficiary" className={`mt-4 inline-block ${MUTED_LINK}`}>
          Try again
        </a>
      </section>
    );
  }

  return <BeneficiarySettings beneficiary={result.beneficiary} notice={result.notice} />;
}
