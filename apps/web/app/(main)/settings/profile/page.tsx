import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_KEYS, SITE_CONFIG } from '@/lib/constants';
import { getMyProfile } from '@/lib/services/profile';
import ProfileSettings from '@/components/profile/ProfileSettings';
import { ERROR_CLASS, MUTED_LINK } from '@/components/ui/surfaces';

export const metadata: Metadata = {
  title: `Profile settings — ${SITE_CONFIG.name}`,
  // Auth-gated PII surface — keep it out of the index.
  robots: { index: false, follow: false },
};

// Auth-gated Server Component. Reads the httpOnly cookie, fetches the editable profile, and hands it to the
// client orchestrator. On a read failure it renders a BLOCKING error (not an empty editable form — saving off
// a failed read would fabricate data); a 401 redirects to sign in.
export default async function ProfileSettingsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_KEYS.accessToken)?.value;
  if (!token) redirect('/login');

  const result = await getMyProfile(token);

  if (result.status === 'error') {
    if (result.code === 'SESSION_EXPIRED') redirect('/login');
    return (
      <section className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="font-heading text-3xl text-charcoal">Profile</h1>
        <p className={`mt-6 ${ERROR_CLASS}`} role="alert">
          {result.message}
        </p>
        {/* A plain link re-runs the Server Component read — no stale client state to reconcile. */}
        <a href="/settings/profile" className={`mt-4 inline-block ${MUTED_LINK}`}>
          Try again
        </a>
      </section>
    );
  }

  return <ProfileSettings profile={result.profile} />;
}
