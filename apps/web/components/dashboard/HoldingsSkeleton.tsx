// First skeleton in the repo. Streamed as the <Suspense> fallback while the server awaits getHoldings. Rows
// match HoldingRow geometry (60×60 tile + text bars + button ghosts) to avoid layout shift on hydration.
// A11y: the container announces once via role="status" (implies aria-live="polite"); shimmer children are
// aria-hidden and the pulse is gated behind motion-safe: (respects prefers-reduced-motion).
const ROW_KEYS = ['a', 'b', 'c'];

export default function HoldingsSkeleton() {
  return (
    <div role="status" aria-label="Loading your fractions">
      <ul className="divide-y divide-charcoal/10">
        {ROW_KEYS.map((key) => (
          <li key={key} aria-hidden="true" className="flex items-center gap-4 py-4">
            <div className="h-[60px] w-[60px] shrink-0 rounded bg-charcoal/10 motion-safe:animate-pulse" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-2/5 rounded bg-charcoal/10 motion-safe:animate-pulse" />
              <div className="h-3 w-1/4 rounded bg-charcoal/10 motion-safe:animate-pulse" />
            </div>
            <div className="hidden gap-2 sm:flex">
              <div className="h-10 w-28 rounded-sm bg-charcoal/10 motion-safe:animate-pulse" />
              <div className="h-10 w-28 rounded-sm bg-charcoal/10 motion-safe:animate-pulse" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
