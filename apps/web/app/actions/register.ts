'use server';

import { z } from 'zod/v4';
import type { RegisterState } from '@/lib/types/api';
import { registerUser } from '@/lib/services/auth';
import { extractFieldErrors } from '@/lib/validation';

const registerSchema = z
  .object({
    firstName: z.string().trim().min(1, 'First name is required').max(100),
    lastName: z.string().trim().min(1, 'Last name is required').max(100),
    email: z.email('Please enter a valid email address').max(254),
    password: z
      .string()
      .min(12, 'Password must be at least 12 characters')
      .max(128, 'Password must not exceed 128 characters')
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])/,
        'Password must include lowercase, uppercase, a digit, and a special character (!@#$%^&*)',
      ),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export async function registerAction(
  _prevState: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const raw = {
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    email: formData.get('email'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  };

  const result = registerSchema.safeParse(raw);

  if (!result.success) {
    return {
      status: 'error',
      message: 'Please fix the errors below',
      fieldErrors: extractFieldErrors(result.error),
    };
  }

  const { firstName, lastName, email, password } = result.data;

  return registerUser({ firstName, lastName, email, password });
}
