import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next/image', () => ({
  default: ({ src, alt, onError }: { src: string; alt: string; onError?: () => void }) => {
    // eslint-disable-next-line @next/next/no-img-element -- test mock stands in for next/image, forwards onError
    return <img src={src} alt={alt} onError={onError} data-testid="thumb" />;
  },
}));

import ArtworkThumbnail from '@/components/dashboard/ArtworkThumbnail';

describe('ArtworkThumbnail', () => {
  it('renders the image when a URL is present', () => {
    render(<ArtworkThumbnail url="https://cdn.test/x.jpg" title="Sunrise over the Estuary" />);
    expect(screen.getByTestId('thumb')).toBeInTheDocument();
  });

  it('swaps to the initials placeholder when the image fails to load (onError)', () => {
    render(<ArtworkThumbnail url="https://cdn.test/x.jpg" title="Sunrise over the Estuary" />);
    fireEvent.error(screen.getByTestId('thumb'));
    expect(screen.queryByTestId('thumb')).toBeNull();
    expect(screen.getByText('SO')).toBeInTheDocument(); // "Sunrise Over"
  });

  it('renders the initials placeholder (no image) when the URL is null', () => {
    render(<ArtworkThumbnail url={null} title="Sunrise over the Estuary" />);
    expect(screen.queryByTestId('thumb')).toBeNull();
    expect(screen.getByText('SO')).toBeInTheDocument();
  });

  it('derives initials from a single-word title', () => {
    render(<ArtworkThumbnail url={null} title="Monet" />);
    expect(screen.getByText('M')).toBeInTheDocument();
  });

  it('falls back to an em dash for an empty title', () => {
    render(<ArtworkThumbnail url={null} title="" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
