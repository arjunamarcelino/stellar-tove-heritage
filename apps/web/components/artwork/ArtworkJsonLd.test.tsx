import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { artwork } from '@/test/fixtures/artworks';
import ArtworkJsonLd from '@/components/artwork/ArtworkJsonLd';

function scriptText(el: HTMLElement): string {
  const script = el.querySelector('script[type="application/ld+json"]');
  return script?.innerHTML ?? '';
}

describe('ArtworkJsonLd', () => {
  it('T27: emits a VisualArtwork graph using the UNSIGNED primary image only', () => {
    const { container } = render(<ArtworkJsonLd artwork={artwork} />);
    const data = JSON.parse(scriptText(container));
    expect(data['@type']).toBe('VisualArtwork');
    expect(data.name).toBe('Northern Lights');
    expect(data.image).toBe(artwork.primaryImageUrl);
    expect(data.creator).toEqual({ '@type': 'Person', name: 'Sophie Tove' });
    // Never leak a signed URL into structured data.
    expect(scriptText(container)).not.toContain('signed.cdn.tove.test');
  });

  it('T27: is XSS-safe — a </script> in the title round-trips inert with no literal </', () => {
    const evil = { ...artwork, title: 'Untitled</script><script>alert(1)</script>' };
    const { container } = render(<ArtworkJsonLd artwork={evil} />);
    const raw = scriptText(container);
    expect(raw).not.toContain('</');
    expect(raw).toContain('\\u003c');
    // Still valid JSON that round-trips the original string.
    expect(JSON.parse(raw).name).toBe('Untitled</script><script>alert(1)</script>');
  });

  it('T27: omits null fields from the graph', () => {
    const sparse = {
      ...artwork,
      primaryImageUrl: null,
      artistName: null,
      medium: null,
      year: null,
    };
    const { container } = render(<ArtworkJsonLd artwork={sparse} />);
    const data = JSON.parse(scriptText(container));
    expect(data).not.toHaveProperty('image');
    expect(data).not.toHaveProperty('creator');
    expect(data).not.toHaveProperty('artMedium');
    expect(data).not.toHaveProperty('dateCreated');
  });
});
