// Shared spinning ring (promoted from the per-feature copies in accept / wallet / auth — todo 187). The ring
// COLORS are theme-specific (dark dialogs vs the light marketplace), so the caller passes the track + top-border
// classes via `className` (e.g. 'border-charcoal/20 border-t-ochre'). `size` picks the two sizes in use: 'lg' is
// centered (mx-auto, h-8) for standalone status blocks; 'sm' (h-6) sits inline in a flex row. Decorative →
// aria-hidden; a sibling live region announces the actual status.
export default function Spinner({
  size = 'lg',
  className = '',
}: {
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const sizeClass = size === 'sm' ? 'h-6 w-6' : 'mx-auto h-8 w-8';
  return (
    <div
      aria-hidden="true"
      className={`${sizeClass} animate-spin rounded-full border-2 motion-reduce:animate-none ${className}`}
    />
  );
}
