'use client';

import { useId } from 'react';
import Link from 'next/link';
import ArtworkThumbnail from '@/components/dashboard/ArtworkThumbnail';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '@/components/ui/buttons';
import { artworkHref, rfqHref, formatFractionCount, isZero } from '@/lib/holdings/format';
import type { Holding } from '@/lib/types/api';

// One holding row: 60×60 thumbnail | title + artist handle | balance | View / Sell CTAs.
export default function HoldingRow({ holding }: { holding: Holding }) {
  const {
    artworkTitle,
    artworkSlug,
    artworkImageUrl,
    artistHandle,
    tokenContract,
    balance,
    lockedBalance,
    freeBalance,
  } = holding;

  const locked = !isZero(lockedBalance);
  const sellDisabled = isZero(freeBalance);
  // Source the disabled-Sell reason from the SAME signal as the visual "locked" annotation, so the two can't
  // contradict (e.g. balance 60 / locked 0 / free 0 must not show "60" yet claim "all fractions locked").
  const allLocked = BigInt(lockedBalance) === BigInt(balance);
  const sellReason = allLocked
    ? 'All fractions locked — nothing to sell.'
    : 'No fractions available to sell.';
  // Decoupled from tokenContract (a stray/whitespace value would break the aria linkage); stable + unique.
  const sellDescId = useId();

  // Format once, reuse in the visual glyph + the accessible name.
  const balanceText = formatFractionCount(balance);
  const lockedText = locked ? formatFractionCount(lockedBalance) : '';
  // Word-form accessible name — the visual "60 · 10 locked" uses a decorative middot that screen readers read
  // inconsistently, so the spoken version spells it out and the visual glyph stays aria-hidden.
  const balanceLabel = locked
    ? `${balanceText} fractions, ${lockedText} locked`
    : `${balanceText} fractions`;

  return (
    <li className="flex items-center gap-4 py-4">
      <ArtworkThumbnail
        key={artworkImageUrl ?? 'none'}
        url={artworkImageUrl}
        title={artworkTitle}
      />

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-charcoal" title={artworkTitle}>
          {artworkTitle}
        </p>
        {artistHandle ? (
          <p className="truncate text-sm text-charcoal/60" title={artistHandle}>
            {artistHandle}
          </p>
        ) : null}
        <p className="mt-1 text-sm">
          <span aria-hidden="true" className="text-charcoal/80">
            <span className="font-semibold text-charcoal">{balanceText}</span>
            {locked ? <span className="text-charcoal/60"> · {lockedText} locked</span> : null}
          </span>
          <span className="sr-only">{balanceLabel}</span>
        </p>
      </div>

      <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
        <Link href={artworkHref(artworkSlug)} className={SECONDARY_BUTTON}>
          View artwork
        </Link>

        {sellDisabled ? (
          <>
            <button
              type="button"
              aria-disabled="true"
              aria-describedby={sellDescId}
              onClick={(e) => e.preventDefault()}
              className={PRIMARY_BUTTON}
            >
              Sell (RFQ)
            </button>
            <span id={sellDescId} className="sr-only">
              {sellReason}
            </span>
          </>
        ) : (
          <Link href={rfqHref(tokenContract, artworkSlug)} className={PRIMARY_BUTTON}>
            Sell (RFQ)
          </Link>
        )}
      </div>
    </li>
  );
}
