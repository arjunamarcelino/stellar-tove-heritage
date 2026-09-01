import Link from 'next/link';
import type { Artwork } from '@/lib/types/api';
import { PRIMARY_BUTTON } from '@/components/ui/buttons';
import { TONE_CARD_BASE, TONE_NEUTRAL, TONE_ACCENT, MUTED_LINK } from '@/components/ui/surfaces';

// Artwork metadata panel (TOV-190): the <h1> title, artist (plain text — no public artist route yet), the
// present-only metadata rows, a text-carrying status badge, the COA download, and the status-driven CTA. Every
// nullable field omits its row cleanly (the service already collapsed empty strings to null), so no "null"/
// blank ever renders.

// Status conveys meaning by TEXT + heading, never colour alone (brand: ochre accent, no green/red).
const STATUS_LABEL: Record<Artwork['status'], string> = {
  verified: 'Verified',
  fractionalized: 'Available for investment',
};

function MetaRow({ label, value }: { label: string; value: string | number | null }) {
  if (value === null) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wide text-charcoal/50">{label}</dt>
      <dd className="text-sm text-charcoal">{value}</dd>
    </div>
  );
}

export default function ArtworkMetaPanel({ artwork }: { artwork: Artwork }) {
  const isFractionalized = artwork.status === 'fractionalized';
  const hasMeta =
    artwork.year !== null ||
    artwork.medium !== null ||
    artwork.dimensions !== null ||
    artwork.custodian !== null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl text-umber sm:text-4xl">{artwork.title}</h1>
        {artwork.artistName !== null && (
          <p className="text-lg text-charcoal/80">{artwork.artistName}</p>
        )}
      </div>

      {/* Static state, not a live region — no role="status" (it would announce spuriously when the section
          streams in over the skeleton). An sr-only "Status:" gives the label context beyond the bare word. */}
      <div className={`${TONE_CARD_BASE} ${isFractionalized ? TONE_ACCENT : TONE_NEUTRAL} w-fit`}>
        <span className="font-medium">
          <span className="sr-only">Status: </span>
          {STATUS_LABEL[artwork.status]}
        </span>
      </div>

      {hasMeta && (
        <dl className="grid grid-cols-2 gap-4 border-t border-charcoal/10 pt-6 sm:grid-cols-4">
          <MetaRow label="Year" value={artwork.year} />
          <MetaRow label="Medium" value={artwork.medium} />
          <MetaRow label="Dimensions" value={artwork.dimensions} />
          <MetaRow label="Custodian" value={artwork.custodian} />
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-4">
        {isFractionalized ? (
          <Link href={`/artworks/${artwork.id}/offering`} className={PRIMARY_BUTTON}>
            View offering
          </Link>
        ) : (
          <p className="text-sm text-charcoal/60">
            This artwork is verified and not yet available for investment.
          </p>
        )}

        {artwork.coaSignedUrl !== null && (
          <a
            href={artwork.coaSignedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${MUTED_LINK} text-sm`}
          >
            Download Certificate of Authenticity
            <span className="sr-only"> (PDF, opens in new tab)</span>
          </a>
        )}
      </div>
    </div>
  );
}
