import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-[var(--spacing-gutter)] py-[var(--spacing-section)]">
      <h1 className="font-heading text-6xl font-medium text-umber">404</h1>
      <p className="mt-4 text-lg text-flint">Page not found</p>
      <Link
        href="/"
        className="mt-8 inline-flex items-center justify-center font-body text-sm font-medium uppercase tracking-widest transition-colors duration-200 min-h-[44px] px-8 py-3 bg-ochre text-cream hover:bg-sienna rounded-sm"
      >
        Return Home
      </Link>
    </div>
  );
}
