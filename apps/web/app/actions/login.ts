'use server';

import { z } from 'zod/v4';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { LoginState } from '@/lib/types/api';
import { loginUser } from '@/lib/services/auth';
import { extractFieldErrors } from '@/lib/validation';
import { setAuthTokenCookies } from '@/lib/cookies';

const loginSchema = z.object({
  email: z.email('Please enter a valid email address').trim().max(254),
  password: z.string().min(1, 'Password is required').max(128),
});

export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const raw = {
    email: formData.get('email'),
    password: formData.get('password'),
  };

  const result = loginSchema.safeParse(raw);
  if (!result.success) {
    return {
      status: 'error',
      message: 'Please fix the errors below',
      fieldErrors: extractFieldErrors(result.error),
    };
  }

  const { email, password } = result.data;
  const response = await loginUser({ email, password });

  if (response.status === 'success') {
    const cookieStore = await cookies();
    setAuthTokenCookies(cookieStore, response.accessToken, response.refreshToken);
    redirect('/');
  }

  return {
    status: response.status,
    message: response.message,
    fieldErrors: response.fieldErrors,
  };
}
