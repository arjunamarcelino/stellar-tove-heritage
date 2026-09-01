import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { LoginForm } from '@/features/auth/components/login-form';

export const metadata: Metadata = {
  title: 'Login — Tove Backoffice',
};

export default async function LoginPage() {
  const cookieStore = await cookies();
  if (cookieStore.get('access_token')?.value) {
    redirect('/');
  }

  return <LoginForm />;
}
