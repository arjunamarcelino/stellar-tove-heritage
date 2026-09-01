'use client';

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-[var(--spacing-gutter)] py-[var(--spacing-section)]">
      {/* App-wide policy: error pages are never meaningful content and must never be indexed. This is
          the single root error boundary (all route groups share it). Next streams responses, so a
          thrown error isn't a guaranteed 500 and gets no automatic noindex — signal it explicitly here
          (React hoists the <meta> into <head>). */}
      <meta name="robots" content="noindex" />
      <h1 className="font-heading text-4xl font-medium text-umber">Something went wrong</h1>
      <p className="mt-4 text-flint">An unexpected error occurred. Please try again.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-8 inline-flex items-center justify-center font-body text-sm font-medium uppercase tracking-widest transition-colors duration-200 min-h-[44px] px-8 py-3 bg-ochre text-cream hover:bg-sienna rounded-sm"
      >
        Try Again
      </button>
    </div>
  );
}
