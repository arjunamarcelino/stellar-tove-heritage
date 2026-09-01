// Suspense fallback for the artwork detail page (TOV-190). Geometry-matched to the section (hero 4:3 box,
// title bar, status pill, a 4-up meta grid, a supporting-image grid) so streaming in the real content doesn't
// shift layout. A11y: the container announces once via role="status" (implies aria-live="polite"); shimmer
// children are aria-hidden and the pulse is gated behind motion-safe:.
export default function ArtworkDetailSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading artwork"
      className="flex flex-col gap-[var(--spacing-section)]"
    >
      <div
        aria-hidden="true"
        className="relative aspect-[4/3] w-full rounded-md bg-charcoal/10 motion-safe:animate-pulse"
      />

      <div aria-hidden="true" className="flex flex-col gap-6">
        <div className="h-9 w-3/5 rounded bg-charcoal/10 motion-safe:animate-pulse" />
        <div className="h-8 w-40 rounded bg-charcoal/10 motion-safe:animate-pulse" />
        <div className="grid grid-cols-2 gap-4 border-t border-charcoal/10 pt-6 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 rounded bg-charcoal/10 motion-safe:animate-pulse" />
          ))}
        </div>
      </div>

      <div aria-hidden="true" className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="aspect-square rounded-md bg-charcoal/10 motion-safe:animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
