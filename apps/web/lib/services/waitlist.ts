import type { WaitlistState } from '@/lib/types/api';

// In-memory only — does NOT persist across serverless invocations or restarts.
// Replace with api.post('/waitlist', { email }) when Express backend is ready.
const MAX_STUB_ENTRIES = 10_000;
const submitted = new Set<string>();

export async function joinWaitlist(email: string): Promise<WaitlistState> {
  if (submitted.has(email)) {
    // Privacy-safe: same response for duplicate emails
    return { status: 'success', message: 'You have been added to the waitlist!' };
  }

  if (submitted.size < MAX_STUB_ENTRIES) {
    submitted.add(email);
  }

  return { status: 'success', message: 'You have been added to the waitlist!' };
}
