// Suspense fallback for the offering page (TOV-157 / FR-05.03, WS-F). Geometry-matched to the header + bid
// panel (96px tile ghost, title bar, two <dl> bars, a slider bar, the big "you pay" bar) so hydration doesn't
// shift layout — a clone of HoldingsSkeleton. A11y: the container announces once via role="status" (implies
// aria-live="polite"); shimmer children are aria-hidden and the pulse is gated behind motion-safe:.
export default function OfferingSkeleton() {
  return (
    <div role="status" aria-label="Loading offering">
      {/* Header: 96px tile + title + two ledger bars */}
      <div aria-hidden="true" className="flex items-start gap-4">
        <div className="h-24 w-24 shrink-0 rounded bg-charcoal/10 motion-safe:animate-pulse" />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="h-6 w-3/5 rounded bg-charcoal/10 motion-safe:animate-pulse" />
          <div className="grid grid-cols-2 gap-4 border-t border-charcoal/10 pt-3">
            <div className="h-5 w-4/5 rounded bg-charcoal/10 motion-safe:animate-pulse" />
            <div className="h-5 w-3/5 rounded bg-charcoal/10 motion-safe:animate-pulse" />
          </div>
        </div>
      </div>

      {/* Panel: price bar + slider bar + big "you pay" bar */}
      <div aria-hidden="true" className="mt-8 space-y-4">
        <div className="h-10 w-full rounded bg-charcoal/10 motion-safe:animate-pulse" />
        <div className="h-2 w-full rounded bg-charcoal/10 motion-safe:animate-pulse" />
        <div className="h-12 w-1/2 rounded bg-charcoal/10 motion-safe:animate-pulse" />
      </div>
    </div>
  );
}
