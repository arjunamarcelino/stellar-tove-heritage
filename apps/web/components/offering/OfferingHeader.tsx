import OfferingThumbnail from './OfferingThumbnail';
import { formatUsdc } from '@/lib/offerings/format';
import { OFFERING_CHIP_BASE, OFFERING_CHIP_TONE, MONEY_FIGURE } from './constants';
import type { Offering, OfferingUiState } from '@/lib/types/api';

// The offering masthead (TOV-157 / FR-05.03, WS-F): 96×96 thumbnail + Lora title + a status chip + a <dl>
// "auction-house ledger" of the price band and public float. Every money figure is Lora + tabular-nums.
// Semantics ride on a dot + a word (never colour alone, a11y G10); ochre is reserved for exactly the live
// window, sienna for a canceled offering.

const CHIP_LABEL: Record<OfferingUiState, string> = {
  'coming-soon': 'Opens soon',
  biddable: 'Open',
  closed: 'Closed',
  canceled: 'Canceled',
};

function StatusChip({ uiState }: { uiState: OfferingUiState }) {
  const live = uiState === 'biddable';
  const dotTone = uiState === 'canceled' ? 'bg-sienna' : live ? 'bg-ochre' : 'bg-charcoal/50';
  return (
    <span className={`${OFFERING_CHIP_BASE} ${OFFERING_CHIP_TONE[uiState]}`}>
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${dotTone} ${live ? 'motion-safe:animate-pulse' : ''}`}
      />
      {CHIP_LABEL[uiState]}
    </span>
  );
}

export default function OfferingHeader({
  offering,
  uiState,
}: {
  offering: Offering;
  uiState: OfferingUiState;
}) {
  const { lowPriceStroops, highPriceStroops, publicFloat } = offering;
  // Collapse a degenerate range (low === high) into a single "fixed" figure rather than "N–N".
  const band =
    lowPriceStroops === highPriceStroops
      ? `Fixed at ${formatUsdc(lowPriceStroops)} USDC`
      : `${formatUsdc(lowPriceStroops)}–${formatUsdc(highPriceStroops)} USDC`;

  return (
    <header className="flex items-start gap-4">
      <OfferingThumbnail url={offering.artworkImageUrl} title={offering.artworkTitle} />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-heading text-2xl text-umber">{offering.artworkTitle}</h1>
            {offering.artistHandle ? (
              <p className="text-sm text-charcoal/60">{offering.artistHandle}</p>
            ) : null}
          </div>
          <StatusChip uiState={uiState} />
        </div>

        <dl className="grid grid-cols-2 gap-4 border-t border-charcoal/10 pt-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-charcoal/50">Price band</dt>
            <dd className={`mt-0.5 text-base ${MONEY_FIGURE}`}>{band}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-charcoal/50">Public float</dt>
            <dd className={`mt-0.5 text-base ${MONEY_FIGURE}`}>{publicFloat} fractions</dd>
          </div>
        </dl>
      </div>
    </header>
  );
}
