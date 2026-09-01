import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_KEYS, ONBOARDING_NEXT_PATH, SITE_CONFIG } from '@/lib/constants';
import { getHandle } from '@/lib/services/handle';
import HandlePicker from '@/components/onboarding/HandlePicker';

export const metadata: Metadata = {
  title: `Choose your handle — ${SITE_CONFIG.name}`,
};

// Required post-registration onboarding step (FR-01.05). The cookie-presence check is the
// authoritative auth gate and runs FIRST. The entry read is per-request (the page is dynamic — it
// reads cookies), so a just-committed handle is never read stale:
//  • success + non-null handle → auto-skip (idempotent onboarding — a returning user isn't re-prompted)
//  • error + SESSION_EXPIRED (401) → /login
//  • success + null OR a transient error → fail-open and render the picker (the commit is an idempotent
//    upsert, so a user who already had a handle can safely re-enter it).
export default async function HandlePickerPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_KEYS.accessToken)?.value;
  if (!token) redirect('/login');

  const existing = await getHandle(token);
  if (existing.status === 'success' && existing.handle) redirect(ONBOARDING_NEXT_PATH);
  if (existing.status === 'error' && existing.code === 'SESSION_EXPIRED') redirect('/login');

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-black">
      <section className="w-full max-w-md px-6 py-16">
        <h1 className="font-heading text-3xl text-white">Choose your handle</h1>
        <p className="mt-2 text-sm text-white/60">
          This is how other collectors will find you on Tove.
        </p>
        <div className="mt-8">
          <HandlePicker />
        </div>
      </section>
    </div>
  );
}
