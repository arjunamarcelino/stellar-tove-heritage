import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_KEYS, SITE_CONFIG } from '@/lib/constants';

export const metadata: Metadata = {
  title: `Dashboard — ${SITE_CONFIG.name}`,
};

export default async function DashboardPage() {
  // Auth gate (parity with /settings): the (main) layout only renders chrome, so protected pages gate
  // themselves. The handle commit redirects here, so an unauthenticated direct hit must not render.
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_KEYS.accessToken)?.value;
  if (!token) redirect('/login');

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <h1 className="font-heading text-3xl text-charcoal">Dashboard</h1>
    </div>
  );
}
