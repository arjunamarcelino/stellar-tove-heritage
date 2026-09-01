import Image from 'next/image';
import type { ProfileImageUrls } from '@/lib/types/api';
import { isOptimizable } from '@/lib/images';

// The collector's avatar, one image per size variant (TOV-35 / FR-01.09). When the derived image is present it
// renders the variant's URL through next/image at an explicit square size — optimizing only URLs the Next
// optimizer's remotePatterns actually accept (isOptimizable), else falling back to a direct <img> (unoptimized)
// so a signed/off-allowlist URL can't throw the un-catchable "hostname not configured" error at SSR (mirrors
// ArtworkImage). With no image it renders an initials fallback: a role="img" container named by `name`, the
// letters themselves aria-hidden so a screen reader announces the name once, not the glyphs.

type Variant = 'thumb' | 'card' | 'hero';

const URL_KEY: Record<Variant, keyof ProfileImageUrls> = {
  thumb: 'thumbUrl',
  card: 'cardUrl',
  hero: 'heroUrl',
};

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = (words[0]?.[0] ?? '') + (words[1]?.[0] ?? '');
  return letters.toUpperCase() || '—';
}

export default function Avatar({
  image,
  name,
  variant = 'card',
  size,
}: {
  image: ProfileImageUrls | null;
  name: string;
  variant?: Variant;
  size: number;
}) {
  if (!image) {
    return (
      <div
        role="img"
        aria-label={name}
        style={{ width: size, height: size }}
        className="flex items-center justify-center rounded-full bg-charcoal/10 font-semibold text-charcoal/60"
      >
        <span aria-hidden="true">{initials(name)}</span>
      </div>
    );
  }

  const url = image[URL_KEY[variant]];
  return (
    <Image
      src={url}
      alt="Your profile photo"
      width={size}
      height={size}
      unoptimized={!isOptimizable(url)}
      // Only the hero (a page-LCP candidate) hints high priority; thumb/card are incidental (Next 16: the
      // `priority` prop is deprecated in favour of fetchPriority).
      {...(variant === 'hero' ? { fetchPriority: 'high' as const } : {})}
      className="rounded-full object-cover"
    />
  );
}
