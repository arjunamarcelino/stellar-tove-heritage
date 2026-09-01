'use client';

import { useState } from 'react';
import Image from 'next/image';

// 60×60 artwork thumbnail. Decorative (`alt=""`) because the artwork title is rendered adjacently — a titled
// alt would double-announce. Guards a null/empty URL (never mounts <Image> with an empty src) and swaps to an
// initials placeholder on load failure (expired/404/network), so a broken image never collapses the row or
// blocks its CTAs. The parent keys this by URL, so a new URL remounts and clears any prior error state.

function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const letters = (words[0]?.[0] ?? '') + (words[1]?.[0] ?? '');
  return letters.toUpperCase() || '—';
}

function Placeholder({ title }: { title: string }) {
  return (
    <div
      aria-hidden="true"
      className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded bg-charcoal/10 text-xs font-semibold text-charcoal/60"
    >
      {initials(title)}
    </div>
  );
}

export default function ArtworkThumbnail({ url, title }: { url: string | null; title: string }) {
  const [failed, setFailed] = useState(false);

  if (!url || failed) return <Placeholder title={title} />;

  // `unoptimized`: at a fixed 60×60 the optimizer's byte savings are marginal, and skipping it removes both
  // the per-image cold-start optimizer cost and the "hostname not configured" throw at SSR if the backend
  // ever emits an off-allowlist host (that throw is not catchable by onError). width/height still reserve the
  // box (no CLS); onError still swaps to the placeholder on a 404/expired image.
  return (
    <Image
      src={url}
      width={60}
      height={60}
      alt=""
      unoptimized
      className="h-[60px] w-[60px] shrink-0 rounded object-cover"
      onError={() => setFailed(true)}
    />
  );
}
