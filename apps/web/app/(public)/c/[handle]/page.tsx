import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SITE_CONFIG } from '@/lib/constants';
import { getCollectorByHandle } from '@/lib/services/collectors';
import { handleSchema } from '@/lib/handle/schemas';
import PreviouslyKnownAs from '@/components/profile/PreviouslyKnownAs';

type PageParams = { params: Promise<{ handle: string }> };

// Thrown here (not in the service) on a transient/malformed read → app/error.tsx. Typed so tests assert
// on identity, not a copy-editable string; the message stays STATIC — never interpolate backend detail
// (todo 110: colocated with the throw, out of the server-only service).
export class CollectorProfileLoadError extends Error {
  constructor() {
    super('Failed to load collector profile');
    this.name = 'CollectorProfileLoadError';
  }
}

// noindex by default (privacy: a former handle must not become searchable). Title uses the URL param
// to avoid a second backend call; the page is noindex, so casing/canonical are moot. The param is
// schema-guarded first so a malformed URL can't reflect an arbitrary/nonexistent handle into <title>
// (todo 107) — invalid → a generic title.
export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { handle } = await params;
  const robots = { index: false, follow: true } as const;
  if (!handleSchema.safeParse(handle).success) return { title: SITE_CONFIG.name, robots };
  return { title: `@${handle} — ${SITE_CONFIG.name}`, robots };
}

// Public collector profile (TOV-44 / FR-01.06). not_found → the static 404; a transient/malformed read
// → throw to app/error.tsx (never degrade a fetch failure into a rendered "no history" profile, which
// would misrepresent the collector). (public)/layout.tsx owns Header + <main> + Footer.
export default async function CollectorProfilePage({ params }: PageParams) {
  const { handle } = await params; // Next 16: params is a Promise
  const result = await getCollectorByHandle(handle);

  if (result.status === 'not_found') notFound(); // → app/not-found.tsx
  if (result.status === 'error') throw new CollectorProfileLoadError(); // → app/error.tsx

  const { profile } = result;
  return (
    <section className="mx-auto w-full max-w-md px-[var(--spacing-gutter)] py-[var(--spacing-section)]">
      <h1 className="font-heading text-3xl text-umber">@{profile.handle}</h1>
      <PreviouslyKnownAs handles={profile.previousHandles} />
    </section>
  );
}
