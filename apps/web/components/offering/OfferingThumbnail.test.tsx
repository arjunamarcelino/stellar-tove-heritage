import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next/image', () => ({
  default: ({ src, alt, onError }: { src: string; alt: string; onError?: () => void }) => {
    // eslint-disable-next-line @next/next/no-img-element -- test mock stands in for next/image, forwards onError
    return <img src={src} alt={alt} onError={onError} data-testid="thumb" />;
  },
}));

import OfferingThumbnail from '@/components/offering/OfferingThumbnail';

describe('OfferingThumbnail', () => {
  it('renders the image when a URL is present, decorative (empty alt)', () => {
    render(<OfferingThumbnail url="https://cdn.test/x.jpg" title="Untitled No. 7" />);
    const img = screen.getByTestId('thumb');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('alt', '');
  });

  it('swaps to the initials placeholder when the image fails to load (onError)', () => {
    render(<OfferingThumbnail url="https://cdn.test/x.jpg" title="Untitled Nocturne" />);
    fireEvent.error(screen.getByTestId('thumb'));
    expect(screen.queryByTestId('thumb')).toBeNull();
    expect(screen.getByText('UN')).toBeInTheDocument();
  });

  it('renders the initials placeholder (no image) when the URL is null', () => {
    render(<OfferingThumbnail url={null} title="Untitled Nocturne" />);
    expect(screen.queryByTestId('thumb')).toBeNull();
    expect(screen.getByText('UN')).toBeInTheDocument();
  });

  it('falls back to an em dash for an empty title', () => {
    render(<OfferingThumbnail url={null} title="" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
