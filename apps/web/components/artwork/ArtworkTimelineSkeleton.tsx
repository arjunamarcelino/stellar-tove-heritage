// Suspense fallback for the provenance timeline section (TOV-192). Geometry-matched to a short stack of event
// cards so streaming in the real content doesn't shift layout. A11y: container announces once via role="status"
// (implies aria-live="polite"); shimmer children are aria-hidden and the pulse is gated behind motion-safe:.
export default function ArtworkTimelineSkeleton() {
  return (
    <div role="status" aria-label="Loading provenance timeline" className="flex flex-col gap-4">
      <div
        aria-hidden="true"
        className="h-8 w-40 self-center rounded bg-charcoal/10 motion-safe:animate-pulse"
      />
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="h-24 rounded-md bg-charcoal/10 motion-safe:animate-pulse"
        />
      ))}
    </div>
  );
}
