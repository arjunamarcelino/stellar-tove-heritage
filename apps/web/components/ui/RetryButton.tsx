'use client';

import { useRouter } from 'next/navigation';
import { SECONDARY_BUTTON } from '@/components/ui/buttons';

// Shared load-error recovery button (promoted from the accept + quote copies — todo 187). A same-route <Link>
// is unreliable — the App Router dedupes a soft navigation to the current URL and may not re-run the dynamic
// Server Component; router.refresh() forces a fresh server render of the current route.
export default function RetryButton({ label = 'Retry' }: { label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className={`${SECONDARY_BUTTON} mt-2 self-start`}
    >
      {label}
    </button>
  );
}
