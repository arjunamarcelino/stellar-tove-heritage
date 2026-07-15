import type { Metadata } from 'next';
import { SITE_CONFIG } from '@/lib/constants';
import WaitlistSection from '@/components/sections/WaitlistSection';

export const metadata: Metadata = {
  title: `Join the Waitlist — ${SITE_CONFIG.name}`,
  description: `Be the first to access ${SITE_CONFIG.name}. Sign up for early access to fractional art ownership.`,
};

export default function WaitlistPage() {
  return (
    <>
      <div className="mx-auto max-w-[var(--width-narrow)] px-[var(--spacing-gutter)] pt-[var(--spacing-section)]">
        <h1 className="font-heading text-4xl font-medium text-umber md:text-5xl text-center">
          Get Early Access
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-flint text-center max-w-prose mx-auto">
          Tove Heritage is building the future of art investment. Be among the first to own
          fractions of museum-quality masterpieces through blockchain tokenization.
        </p>
      </div>
      <WaitlistSection />
    </>
  );
}
