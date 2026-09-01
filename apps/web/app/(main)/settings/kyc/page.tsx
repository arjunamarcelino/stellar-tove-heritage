import type { Metadata, Route } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_KEYS, SITE_CONFIG } from '@/lib/constants';
import { getKycStatus, getWhitelistStatus } from '@/lib/services/kyc';
import KycWizard from '@/components/kyc/KycWizard';
import KycStatusView from '@/components/kyc/KycStatusView';
import WhitelistStatusCard from '@/components/kyc/WhitelistStatusCard';
import { KYC_ERROR_CLASS } from '@/components/kyc/constants';

export const metadata: Metadata = {
  title: `Identity verification — ${SITE_CONFIG.name}`,
  // Auth-gated PII surface — keep it out of the index.
  robots: { index: false, follow: false },
};

// The status surface FR-01.08 will own. Until it ships, point back here: after a submission this page
// renders the "under review" view (kycStatus is now pending_review).
const STATUS_HREF = '/settings/kyc' as Route;

// Auth-gated Server Component. Reads the httpOnly cookie, fetches kycStatus, and gates: already
// approved/pending → status view (never the form); not_submitted/rejected → the wizard.
export default async function KycPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_KEYS.accessToken)?.value;
  if (!token) redirect('/login');

  // Two independent reads (parallel): the WHITELIST status (FR-01.08) drives the card at the top; the
  // submission status (FR-01.07) drives the wizard/status-view gate below. They coexist — the card is
  // additive and never gates the existing flow.
  const [whitelist, result] = await Promise.all([getWhitelistStatus(token), getKycStatus(token)]);

  return (
    <section className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-heading text-3xl text-charcoal">Identity verification</h1>
      <p className="mt-2 text-sm text-charcoal/60">
        Verify your identity to unlock investing on Tove.
      </p>

      <div className="mt-8">
        <WhitelistStatusCard initial={whitelist} />
      </div>

      <div className="mt-8">
        {result.status === 'error' ? (
          <p className={KYC_ERROR_CLASS} role="alert">
            {result.message}
          </p>
        ) : result.kycStatus === 'approved' ? (
          <KycStatusView variant="approved" statusHref={STATUS_HREF} />
        ) : result.kycStatus === 'pending_review' ? (
          <KycStatusView variant="pending" statusHref={STATUS_HREF} />
        ) : (
          <KycWizard
            statusHref={STATUS_HREF}
            previouslyRejected={result.kycStatus === 'rejected'}
          />
        )}
      </div>
    </section>
  );
}
