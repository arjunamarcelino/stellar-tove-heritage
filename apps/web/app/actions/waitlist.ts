'use server';

import { z } from 'zod/v4';
import { joinWaitlist } from '@/lib/services/waitlist';
import type { WaitlistState } from '@/lib/types/api';

const emailSchema = z.email('Please enter a valid email address').max(254);

export async function waitlistAction(
  _prevState: WaitlistState,
  formData: FormData,
): Promise<WaitlistState> {
  const raw = formData.get('email');

  if (typeof raw !== 'string') {
    return { status: 'error', message: 'Please enter a valid email address' };
  }

  const result = emailSchema.safeParse(raw);

  if (!result.success) {
    return { status: 'error', message: result.error.issues[0]?.message ?? 'Invalid email' };
  }

  return joinWaitlist(result.data);
}
