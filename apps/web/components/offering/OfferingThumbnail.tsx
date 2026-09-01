'use client';

import { useState } from 'react';
import Image from 'next/image';
import { isOptimizable } from '@/lib/images';

// 96×96 offering hero thumbnail — a geometry-scaled clone of the dashboard ArtworkThumbnail. Decorative
// (`alt=""`) because the artwork title renders adjacently in the header (a titled alt would double-announce).
// Guards a null/empty URL (never mounts <Image> with an empty src) and swaps to an initials placeholder on
// load failure (expired/404/network), so a broken image never collapses the masthead. The parent keys this by
// URL, so a new URL remounts and clears any prior error state.

function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const letters = (words[0]?.[0] ?? '') + (words[1]?.[0] ?? '');
  return letters.toUpperCase() || '—';
}

function Placeholder({ title }: { title: string }) {
  return (
    <div
      aria-hidden="true"
      className="flex h-24 w-24 shrink-0 items-center justify-center rounded bg-charcoal/10 text-lg font-semibold text-charcoal/60"
    >
      {initials(title)}
    </div>
  );
}

// The optimizer allowlist (host + public-object path + no query) lives in lib/images.ts — a single source of
// truth shared with next.config `remotePatterns` and ArtworkImage, so an off-allowlist host falls back to
// `unoptimized` (a plain <img>, no SSR throw) and the gate can never drift from what the optimizer accepts.

export default function OfferingThumbnail({ url, title }: { url: string | null; title: string }) {
  const [failed, setFailed] = useState(false);

  if (!url || failed) return <Placeholder title={title} />;

  // The offering hero is prominent/above the fold, so it's worth optimizing (right-sizing/AVIF/WebP) rather
  // than shipping the full-resolution master for a 96×96 tile (todo 150). Optimize only the allowlisted host;
  // a valid-but-off-allowlist https URL stays `unoptimized` (renders a plain <img>, no SSR throw). `priority`
  // + `sizes` avoid lazy-loading and give the right srcset candidate; width/height reserve the box (no CLS);
  // onError swaps to the placeholder.
  const optimizable = isOptimizable(url);
  return (
    <Image
      src={url}
      width={96}
      height={96}
      alt=""
      sizes="96px"
      priority
      unoptimized={!optimizable}
      className="h-24 w-24 shrink-0 rounded object-cover"
      onError={() => setFailed(true)}
    />
  );
}
