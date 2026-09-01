'use client';

import { useState } from 'react';
import Image from 'next/image';
import { isOptimizable } from '@/lib/images';

// Artwork image with two variants (TOV-190). Both fill a positioned, aspect-ratio-reserved parent (no CLS)
// and swap to an initials placeholder when the URL is null or fails to load (expired/404/network) so a broken
// image never collapses the layout. `hero` optimizes the UNSIGNED primaryImageUrl (AVIF/WebP + srcset via the
// Next optimizer when its host is allowlisted) and hints fetchPriority=high; `grid` renders the SIGNED
// supporting images unoptimized (their host is off-allowlist) and lazy-loads them below the fold. Parents key
// this by URL, so a new URL remounts and clears any prior error state.

function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const letters = (words[0]?.[0] ?? '') + (words[1]?.[0] ?? '');
  return letters.toUpperCase() || '—';
}

function Placeholder({
  title,
  decorative,
  label,
}: {
  title: string;
  decorative: boolean;
  label: string;
}) {
  // Decorative (hero): aria-hidden — the title/artist render adjacently. Non-decorative (grid): expose the
  // same accessible name the <Image> alt carried, so a failed thumbnail keeps its link's descriptive name.
  const a11y = decorative
    ? { 'aria-hidden': 'true' as const }
    : { role: 'img', 'aria-label': label };
  return (
    <div
      {...a11y}
      className="absolute inset-0 flex items-center justify-center bg-charcoal/10 text-2xl font-semibold text-charcoal/50"
    >
      {initials(title)}
    </div>
  );
}

// Optimizer allowlist (host + public-object path + no query) lives in lib/images.ts so it can never drift from
// next.config `remotePatterns`; a URL it rejects renders `unoptimized` (direct <img>) rather than throwing the
// un-catchable "hostname not configured" error at SSR.

type Variant = 'hero' | 'grid';

export default function ArtworkImage({
  url,
  title,
  alt,
  variant,
}: {
  url: string | null;
  title: string;
  alt: string;
  variant: Variant;
}) {
  const [failed, setFailed] = useState(false);

  // Hero placeholder is decorative (the title/artist render adjacently); a grid placeholder keeps its alt as
  // the accessible label since the thumbnail is the only content of its link.
  if (!url || failed)
    return <Placeholder title={title} decorative={variant === 'hero'} label={alt} />;

  const optimizable = isOptimizable(url);
  const isHero = variant === 'hero';
  return (
    <Image
      src={url}
      alt={alt}
      fill
      sizes={isHero ? '(max-width: 768px) 100vw, 66vw' : '(max-width: 768px) 50vw, 25vw'}
      // Hero is the LCP → fetchPriority high (Next 16: `priority` is deprecated). Grid is below the fold →
      // native lazy load; never eager/preload (it would steal bandwidth from the hero on a slow link).
      {...(isHero ? { fetchPriority: 'high' as const } : { loading: 'lazy' as const })}
      unoptimized={!optimizable}
      referrerPolicy="no-referrer"
      className={isHero ? 'object-contain' : 'object-cover'}
      onError={() => setFailed(true)}
    />
  );
}
