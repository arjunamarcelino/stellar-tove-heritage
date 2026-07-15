'use client';

import { useActionState } from 'react';
import { waitlistAction } from '@/app/actions/waitlist';
import type { WaitlistState } from '@/lib/types/api';
const initialState: WaitlistState = { status: 'idle' };

export default function WaitlistSection() {
  const [state, formAction, isPending] = useActionState(waitlistAction, initialState);

  return (
    <section
      id="waitlist"
      aria-labelledby="waitlist-heading"
      className="bg-umber py-[var(--spacing-section)]"
    >
      <div className="mx-auto max-w-[var(--width-narrow)] px-[var(--spacing-gutter)] text-center">
        <span className="block text-xs font-medium uppercase tracking-widest text-rose-ash mb-4">
          Early Access
        </span>
        <h2
          id="waitlist-heading"
          className="font-heading text-3xl font-medium text-bone md:text-4xl lg:text-5xl"
        >
          Be the First to Invest
        </h2>
        <p className="mt-4 mx-auto max-w-prose text-rose-ash">
          Join our waitlist and get early access to fractional art ownership. We&apos;ll notify you
          when we launch.
        </p>

        {state.status === 'success' ? (
          <div className="mt-8 rounded-sm border border-rose-ash/30 bg-umber p-6">
            <p className="text-bone font-medium">{state.message}</p>
          </div>
        ) : (
          <form
            action={formAction}
            className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center"
          >
            <label htmlFor="waitlist-email" className="sr-only">
              Email address
            </label>
            <input
              id="waitlist-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="Enter your email"
              disabled={isPending}
              className="w-full max-w-sm rounded-sm border border-rose-ash/30 bg-umber px-4 py-3 text-bone placeholder:text-flint focus:border-ochre focus:outline-none disabled:opacity-50 sm:flex-1"
            />
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex w-full items-center justify-center font-body text-sm font-medium uppercase tracking-widest transition-colors duration-200 min-h-[44px] px-8 py-3 bg-ochre text-cream hover:bg-sienna rounded-sm disabled:opacity-50 disabled:cursor-not-allowed sm:w-auto"
            >
              {isPending ? 'Joining...' : 'Join Waitlist'}
            </button>
          </form>
        )}

        {state.status === 'error' && !isPending && (
          <p className="mt-4 text-sm text-red-400" role="alert">
            {state.message}
          </p>
        )}
      </div>
    </section>
  );
}
