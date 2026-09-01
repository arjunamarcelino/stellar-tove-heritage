'use client';

import { useCountdown } from '@/hooks/useCountdown';
import { formatUsdc } from '@/lib/money/format';
import {
  ACCEPT_PRIMARY_BUTTON,
  ACCEPT_SECONDARY_BUTTON,
  MONEY_FIGURE,
} from '@/components/accept/constants';
import type { OpenQuote } from '@/lib/types/api';

// The open-quotes list on the buyer's accept surface (TOV-178 / FR-06.04). Static SSR-seeded (the list poller
// was cut — plan D5) with a manual refresh control. Rows arrive backend-sorted price ASC. Each row's Accept CTA
// is gated on `acceptable` (open + seller-authorized) AND !expired (client-derived) AND passkeySupported. The
// one-trade-per-RFQ rule (AC-B) is enforced by the coordinator REPLACING the whole list with the settlement
// panel once a trade exists (stronger than disabling — todo 186), so this list never needs an in-flight gate.
// data-* hooks make the whole list agent-drivable.

type DisabledReason = 'not-acceptable' | 'expired' | 'passkey-unsupported' | null;

function QuoteRow({
  quote,
  passkeySupported,
  onAccept,
}: {
  quote: OpenQuote;
  passkeySupported: boolean;
  onAccept: (quote: OpenQuote) => void;
}) {
  // One clock per row (todo 182): the row derives `expired` and the child renders the display parts from the
  // SAME countdown, so status and text can't drift a tick apart and there's one timer, not two.
  const { days, hours, minutes, expired, pending } = useCountdown(quote.validUntil);
  const isExpired = !pending && expired;

  const disabledReason: DisabledReason = !quote.acceptable
    ? 'not-acceptable'
    : isExpired
      ? 'expired'
      : !passkeySupported
        ? 'passkey-unsupported'
        : null;
  const canAccept = disabledReason === null;

  const reasonHint: Record<Exclude<DisabledReason, null>, string> = {
    'not-acceptable': 'Not yet available — awaiting seller authorization',
    expired: 'This quote has expired',
    'passkey-unsupported': 'This device can’t sign with a passkey',
  };

  return (
    <li
      className="flex flex-wrap items-center justify-between gap-4 border-b border-charcoal/10 py-4"
      data-quote-id={quote.quoteId}
      data-acceptable={quote.acceptable}
      data-quote-status={isExpired ? 'expired' : quote.status}
    >
      <div className="flex flex-col gap-1 text-sm text-charcoal">
        <span className="font-medium text-umber">{quote.sellerHandle ?? 'Anonymous seller'}</span>
        <span className="text-charcoal/60">
          {quote.fractionCount} fractions · {formatUsdc(quote.pricePerFractionStroops)} USDC each
        </span>
        <QuoteRowCountdown
          validUntil={quote.validUntil}
          expired={isExpired}
          days={days}
          hours={hours}
          minutes={minutes}
        />
      </div>

      <div className="flex flex-col items-end gap-1">
        <span className="text-xs uppercase tracking-wide text-charcoal/50">You pay</span>
        <span className={`text-lg ${MONEY_FIGURE}`}>{formatUsdc(quote.grossStroops)} USDC</span>
        <span className="text-[11px] text-charcoal/50">no buyer fees</span>
      </div>

      <div className="flex w-full flex-col items-end gap-1 sm:w-auto">
        <button
          type="button"
          className={ACCEPT_PRIMARY_BUTTON}
          data-accept-cta
          data-cta-disabled-reason={disabledReason ?? undefined}
          disabled={!canAccept}
          onClick={() => onAccept(quote)}
        >
          Accept
        </button>
        {disabledReason && (
          <span className="text-[11px] text-charcoal/50">{reasonHint[disabledReason]}</span>
        )}
      </div>
    </li>
  );
}

// Compact single-line countdown for a row (leaf-owned tick). A static absolute date is the accessible name; the
// visual "expires in …" is aria-hidden. `pending` guards the seeded first frame so a fresh row never flashes
// "Expired" (todo 155).
function QuoteRowCountdown({
  validUntil,
  expired,
  days,
  hours,
  minutes,
}: {
  validUntil: string;
  expired: boolean;
  days: number;
  hours: number;
  minutes: number;
}) {
  if (expired) {
    return (
      <span role="timer" className="text-xs text-sienna">
        <span className="sr-only">Expired.</span>
        <span aria-hidden="true">Expired</span>
      </span>
    );
  }
  const parts =
    days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return (
    <span role="timer" className="text-xs text-charcoal/50">
      <span className="sr-only">Valid until {new Date(validUntil).toISOString()}</span>
      <span aria-hidden="true">Expires in {parts}</span>
    </span>
  );
}

export default function OpenQuotesList({
  quotes,
  passkeySupported,
  refreshing = false,
  onAccept,
  onRefresh,
}: {
  quotes: OpenQuote[];
  passkeySupported: boolean;
  refreshing?: boolean;
  onAccept: (quote: OpenQuote) => void;
  onRefresh: () => void;
}) {
  const emptyState: 'none' | 'all-unacceptable' | undefined =
    quotes.length === 0
      ? 'none'
      : quotes.every((q) => !q.acceptable)
        ? 'all-unacceptable'
        : undefined;

  return (
    <section
      aria-labelledby="open-quotes-heading"
      data-quotes-count={quotes.length}
      data-empty-state={emptyState}
      data-passkey-supported={passkeySupported}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="open-quotes-heading" className="sr-only">
          Open quotes
        </h2>
        <button
          type="button"
          className={ACCEPT_SECONDARY_BUTTON}
          disabled={refreshing}
          onClick={onRefresh}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {emptyState === 'none' ? (
        <p className="py-8 text-center text-sm text-charcoal/60">
          No quotes yet. Sellers will appear here as they respond — check back or refresh.
        </p>
      ) : (
        <>
          {emptyState === 'all-unacceptable' && (
            <p className="mt-3 rounded-md border border-charcoal/15 bg-charcoal/5 p-3 text-sm text-charcoal">
              None of these quotes are ready to accept yet — each seller still needs to authorize
              theirs.
            </p>
          )}
          <ul className="mt-2">
            {quotes.map((quote) => (
              <QuoteRow
                key={quote.quoteId}
                quote={quote}
                passkeySupported={passkeySupported}
                onAccept={onAccept}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
