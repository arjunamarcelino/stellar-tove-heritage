import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { artwork } from '@/test/fixtures/artworks';
import type { Artwork } from '@/lib/types/api';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import ArtworkMetaPanel from '@/components/artwork/ArtworkMetaPanel';

const fractionalized: Artwork = { ...artwork, status: 'fractionalized' };

describe('ArtworkMetaPanel', () => {
  it('T16: verified artwork shows the "not yet available" note and NO offering CTA', () => {
    render(<ArtworkMetaPanel artwork={artwork} />);
    expect(
      screen.getByText('This artwork is verified and not yet available for investment.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view offering/i })).toBeNull();
  });

  it('T17: fractionalized artwork links to the offering page', () => {
    render(<ArtworkMetaPanel artwork={fractionalized} />);
    const cta = screen.getByRole('link', { name: /view offering/i });
    expect(cta).toHaveAttribute('href', `/artworks/${artwork.id}/offering`);
  });

  it('T18: renders the COA download when present, with an accessible name', () => {
    render(<ArtworkMetaPanel artwork={artwork} />);
    const coa = screen.getByRole('link', { name: /download certificate of authenticity/i });
    expect(coa).toHaveAttribute('href', artwork.coaSignedUrl);
    expect(coa).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('T19: omits the COA section when coaSignedUrl is null', () => {
    render(<ArtworkMetaPanel artwork={{ ...artwork, coaSignedUrl: null }} />);
    expect(screen.queryByRole('link', { name: /certificate of authenticity/i })).toBeNull();
  });

  it('T21: omits null metadata rows and the artist line when both artist fields are null', () => {
    render(
      <ArtworkMetaPanel
        artwork={{
          ...artwork,
          artistName: null,
          artistHandle: null,
          year: null,
          medium: null,
          dimensions: null,
          custodian: null,
        }}
      />,
    );
    expect(screen.queryByText('Year')).toBeNull();
    expect(screen.queryByText('Medium')).toBeNull();
    expect(screen.queryByText('Sophie Tove')).toBeNull();
    // No literal null/undefined leaks into the DOM.
    expect(document.body.textContent).not.toMatch(/null|undefined/);
  });

  it('renders title as the h1 and artist as text', () => {
    render(<ArtworkMetaPanel artwork={artwork} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Northern Lights');
    expect(screen.getByText('Sophie Tove')).toBeInTheDocument();
  });

  it('#193/#199: status badge is not a live region and carries a "Status:" context label', () => {
    const { container } = render(<ArtworkMetaPanel artwork={artwork} />);
    expect(screen.queryByRole('status')).toBeNull(); // no spurious live-region announcement
    expect(screen.getByText('Status:')).toBeInTheDocument();
    expect(container.textContent).toContain('Verified');
  });
});
