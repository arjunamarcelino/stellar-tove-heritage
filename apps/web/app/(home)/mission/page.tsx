import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { fetchProfile } from '@/lib/services/auth';
import { COOKIE_KEYS } from '@/lib/constants';
import MissionView from '@/components/sections/MissionView';

export default async function MissionPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_KEYS.accessToken)?.value;

  if (!token) {
    redirect('/login');
  }

  const profile = await fetchProfile(token);

  if (profile.status === 'error') {
    redirect('/');
  }

  return <MissionView stage={profile.currentStage ?? null} />;
}
