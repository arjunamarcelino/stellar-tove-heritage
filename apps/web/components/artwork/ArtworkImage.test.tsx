import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next/image', () => ({
  default: ({
    src,
    alt,
    onError,
    loading,
    fetchPriority,
    unoptimized,
  }: {
    src: string;
    alt: string;
    onError?: () => void;
    loading?: string;
    fetchPriority?: string;
    unoptimized?: boolean;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element -- test mock stands in for next/image
    <img
      src={src}
      alt={alt}
      onError={onError}
      data-loading={loading}
      data-fetchpriority={fetchPriority}
      data-unoptimized={String(!!unoptimized)}
      data-testid="img"
    />
  ),
}));

import ArtworkImage from '@/components/artwork/ArtworkImage';

const SUPABASE = 'https://vasihtrobeqxooujcryw.supabase.co/storage/v1/object/public/artworks/a.jpg';
const SUPABASE_SIGNED =
  'https://vasihtrobeqxooujcryw.supabase.co/storage/v1/object/sign/artworks/a.jpg?token=1';
const SIGNED = 'https://signed.cdn.tove.test/img/a.jpg?token=1';
const OFF_ALLOWLIST_UNSIGNED = 'https://cdn.tove.test/aw-001.jpg';

describe('ArtworkImage', () => {
  it('T24: null URL renders the initials placeholder (no <img>)', () => {
    render(<ArtworkImage url={null} title="Northern Lights" alt="x" variant="hero" />);
    expect(screen.queryByTestId('img')).toBeNull();
    expect(screen.getByText('NL')).toBeInTheDocument();
  });

  it('#199: a failed grid thumbnail keeps its descriptive accessible name (role=img + aria-label)', () => {
    render(
      <ArtworkImage
        url={null}
        title="Northern Lights"
        alt="Northern Lights — supporting image 2 of 3"
        variant="grid"
      />,
    );
    const ph = screen.getByRole('img', { name: 'Northern Lights — supporting image 2 of 3' });
    expect(ph).toBeInTheDocument();
  });

  it('#199: the hero placeholder stays decorative (aria-hidden, no accessible name)', () => {
    render(
      <ArtworkImage
        url={null}
        title="Northern Lights"
        alt="Northern Lights by Sophie Tove"
        variant="hero"
      />,
    );
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('NL')).toBeInTheDocument();
  });

  it('T24: swaps to the placeholder when the image fails to load', () => {
    render(
      <ArtworkImage url={SIGNED} title="Northern Lights" alt="Northern Lights" variant="grid" />,
    );
    fireEvent.error(screen.getByTestId('img'));
    expect(screen.queryByTestId('img')).toBeNull();
    expect(screen.getByText('NL')).toBeInTheDocument();
  });

  it('T24: hero on the allowlisted host is optimized + fetchPriority high', () => {
    render(
      <ArtworkImage url={SUPABASE} title="Northern Lights" alt="Northern Lights" variant="hero" />,
    );
    const img = screen.getByTestId('img');
    expect(img).toHaveAttribute('data-unoptimized', 'false');
    expect(img).toHaveAttribute('data-fetchpriority', 'high');
  });

  it('#190: a same-host SIGNED URL (sign path + query) is unoptimized, not optimized', () => {
    render(
      <ArtworkImage
        url={SUPABASE_SIGNED}
        title="Northern Lights"
        alt="Northern Lights"
        variant="hero"
      />,
    );
    const img = screen.getByTestId('img');
    expect(img).toHaveAttribute('data-unoptimized', 'true');
    expect(img).toHaveAttribute('data-fetchpriority', 'high'); // still the LCP hero
  });

  it('#200: hero on an off-allowlist unsigned CDN is unoptimized but still fetchPriority high', () => {
    render(
      <ArtworkImage
        url={OFF_ALLOWLIST_UNSIGNED}
        title="Northern Lights"
        alt="Northern Lights"
        variant="hero"
      />,
    );
    const img = screen.getByTestId('img');
    expect(img).toHaveAttribute('data-unoptimized', 'true');
    expect(img).toHaveAttribute('data-fetchpriority', 'high');
  });

  it('T24: a signed (off-allowlist) grid image is unoptimized + lazy-loaded', () => {
    render(
      <ArtworkImage
        url={SIGNED}
        title="Northern Lights"
        alt="Northern Lights — supporting image"
        variant="grid"
      />,
    );
    const img = screen.getByTestId('img');
    expect(img).toHaveAttribute('data-unoptimized', 'true');
    expect(img).toHaveAttribute('data-loading', 'lazy');
    expect(img).not.toHaveAttribute('data-fetchpriority', 'high');
  });
});
