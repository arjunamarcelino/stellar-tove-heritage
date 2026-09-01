import ArtworkImage from '@/components/artwork/ArtworkImage';

// Supporting-image grid (TOV-190). Pure SSR: each thumbnail is an anchor to the full signed image (new tab),
// so the page needs no JS to view detail images. Renders nothing when there are no supporting images (the
// backend returns [] when none, or drops any that failed to sign). `rel="noopener noreferrer"` severs
// window.opener AND strips the Referer (keeps the artwork URL out of the CDN's logs); a visually-hidden
// "(opens in new tab)" announces the target change to screen readers.

export default function SupportingImageGrid({
  images,
  title,
}: {
  images: string[];
  title: string;
}) {
  if (images.length === 0) return null;

  return (
    <section aria-labelledby="supporting-images-heading">
      <h2 id="supporting-images-heading" className="font-heading text-lg text-umber">
        Supporting images
      </h2>
      <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {images.map((src, i) => (
          <li key={src}>
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative block aspect-square overflow-hidden rounded-md bg-charcoal/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ochre"
            >
              {/* Distinct accessible name per link (index over the final, post-drop list) so links are
                  distinguishable and countable in a screen-reader rotor. */}
              <ArtworkImage
                url={src}
                title={title}
                alt={`${title} — supporting image ${i + 1} of ${images.length}`}
                variant="grid"
              />
              <span className="sr-only">(opens in new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
