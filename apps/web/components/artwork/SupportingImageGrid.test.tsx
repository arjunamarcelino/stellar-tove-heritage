import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Stub the client image so this SSR grid test doesn't load next/image.
vi.mock('@/components/artwork/ArtworkImage', () => ({ default: () => null }));

import SupportingImageGrid from '@/components/artwork/SupportingImageGrid';

const IMAGES = [
  'https://signed.cdn.tove.test/img/a.jpg?token=1',
  'https://signed.cdn.tove.test/img/b.jpg?token=2',
];

describe('SupportingImageGrid', () => {
  it('T20: renders nothing when there are no supporting images', () => {
    const { container } = render(<SupportingImageGrid images={[]} title="Northern Lights" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('T26: renders each image as a safe new-tab link with an "opens in new tab" cue', () => {
    render(<SupportingImageGrid images={IMAGES} title="Northern Lights" />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', IMAGES[0]);
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getAllByText('(opens in new tab)')).toHaveLength(2);
  });
});
