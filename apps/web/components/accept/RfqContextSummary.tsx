import { formatUsdc } from '@/lib/money/format';
import { MONEY_FIGURE } from '@/components/accept/constants';
import type { RfqDetail } from '@/lib/types/api';

// The RFQ context header on the buyer's accept surface (TOV-178 / FR-06.04). Presentational — renders the
// request's artwork/quantity/ceiling/expiry + a status chip. On `filled` (after a trade settles) the chip flips
// to "Accepted" (AC-A), the buyer's signal the whole flow succeeded. data-rfq-status is the machine-readable
// hook for the same transition.

const STATUS_LABEL: Record<RfqDetail['status'], string> = {
  open: 'Open',
  filled: 'Accepted',
  canceled: 'Canceled',
  expired: 'Expired',
};

export default function RfqContextSummary({ rfq }: { rfq: RfqDetail }) {
  const filled = rfq.status === 'filled';
  return (
    <section aria-labelledby="rfq-context-heading" data-rfq-status={rfq.status}>
      <div className="flex items-center justify-between gap-4">
        <h1 id="rfq-context-heading" className="font-heading text-xl text-umber">
          Quotes on your request
        </h1>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide ${
            filled ? 'bg-ochre/20 text-umber' : 'bg-charcoal/10 text-charcoal'
          }`}
        >
          {STATUS_LABEL[rfq.status]}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-charcoal sm:grid-cols-3">
        <div>
          <dt className="text-charcoal/60">Fractions wanted</dt>
          <dd className={MONEY_FIGURE}>{rfq.fractionCount}</dd>
        </div>
        <div>
          <dt className="text-charcoal/60">Max price / fraction</dt>
          <dd className={MONEY_FIGURE}>{formatUsdc(rfq.maxPricePerFractionStroops)} USDC</dd>
        </div>
        <div>
          <dt className="text-charcoal/60">Request expires</dt>
          <dd className={MONEY_FIGURE}>
            <time dateTime={rfq.expiresAt}>{new Date(rfq.expiresAt).toLocaleDateString()}</time>
          </dd>
        </div>
      </dl>
    </section>
  );
}
