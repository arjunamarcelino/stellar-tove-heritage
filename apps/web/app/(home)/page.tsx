import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { fetchProfile } from '@/lib/services/auth';
import { getHandle } from '@/lib/services/handle';
import { COOKIE_KEYS } from '@/lib/constants';
import Hero from '@/components/sections/Hero';

export default async function Home() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_KEYS.accessToken)?.value;

  if (!token) {
    redirect('/login');
  }

  // The profile fetch and the handle-gate read are independent, so run them in parallel — the home
  // page is the hottest authenticated route and shouldn't pay two serial round-trips.
  const [profile, handle] = await Promise.all([fetchProfile(token), getHandle(token)]);

  if (profile.status === 'error') {
    redirect('/login');
  }

  // Enforce the required handle step (FR-01.05). Both auth paths land here (login redirects to '/',
  // passkey signup router.replace('/')s), so this single guard makes the picker required for everyone
  // regardless of onboarding order. Only redirect when we're SURE there's no handle — a transient
  // getHandle error fails open to the Hero rather than trapping the user (the picker is idempotent, so
  // they'll simply be re-prompted on a later visit). The picker page auto-skips back here once set.
  if (handle.status === 'success' && handle.handle === null) {
    redirect('/onboarding/handle');
  }

  return <Hero firstName={profile.firstName} lastName={profile.lastName} />;
}
