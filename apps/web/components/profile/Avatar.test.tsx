import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/image', () => ({
  default: ({
    src,
    alt,
    width,
    height,
    unoptimized,
    fetchPriority,
  }: {
    src: string;
    alt: string;
    width: number;
    height: number;
    unoptimized?: boolean;
    fetchPriority?: string;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element -- test mock stands in for next/image
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      data-unoptimized={String(!!unoptimized)}
      data-fetchpriority={fetchPriority ?? ''}
      data-testid="img"
    />
  ),
}));

import Avatar from '@/components/profile/Avatar';
import type { ProfileImageUrls } from '@/lib/types/api';

// Public Supabase object URLs are optimizable; a signed/off-allowlist URL is not.
const HOST = 'https://vasihtrobeqxooujcryw.supabase.co/storage/v1/object/public/avatars';
const IMG: ProfileImageUrls = {
  thumbUrl: `${HOST}/thumb.webp`,
  cardUrl: `${HOST}/card.webp`,
  heroUrl: `${HOST}/hero.webp`,
};

describe('Avatar', () => {
  it('selects the URL for each variant', () => {
    const { rerender } = render(
      <Avatar image={IMG} name="Ada Lovelace" variant="thumb" size={40} />,
    );
    expect(screen.getByTestId('img')).toHaveAttribute('src', IMG.thumbUrl);

    rerender(<Avatar image={IMG} name="Ada Lovelace" variant="card" size={128} />);
    expect(screen.getByTestId('img')).toHaveAttribute('src', IMG.cardUrl);

    rerender(<Avatar image={IMG} name="Ada Lovelace" variant="hero" size={256} />);
    const img = screen.getByTestId('img');
    expect(img).toHaveAttribute('src', IMG.heroUrl);
    expect(img).toHaveAttribute('width', '256');
    expect(img).toHaveAttribute('height', '256');
  });

  it('only hints fetchPriority=high for the hero variant', () => {
    const { rerender } = render(<Avatar image={IMG} name="Ada" variant="card" size={128} />);
    expect(screen.getByTestId('img')).toHaveAttribute('data-fetchpriority', '');

    rerender(<Avatar image={IMG} name="Ada" variant="hero" size={256} />);
    expect(screen.getByTestId('img')).toHaveAttribute('data-fetchpriority', 'high');
  });

  it('optimizes an allowlisted public URL and falls back to unoptimized otherwise', () => {
    render(<Avatar image={IMG} name="Ada" variant="card" size={128} />);
    expect(screen.getByTestId('img')).toHaveAttribute('data-unoptimized', 'false');
  });

  it('renders unoptimized for an off-allowlist (signed) URL', () => {
    const signed: ProfileImageUrls = {
      thumbUrl: `${HOST.replace('/public/', '/sign/')}/thumb.webp?token=1`,
      cardUrl: `${HOST.replace('/public/', '/sign/')}/card.webp?token=1`,
      heroUrl: `${HOST.replace('/public/', '/sign/')}/hero.webp?token=1`,
    };
    render(<Avatar image={signed} name="Ada" variant="card" size={128} />);
    expect(screen.getByTestId('img')).toHaveAttribute('data-unoptimized', 'true');
  });

  it('renders an initials fallback with role=img named by the collector when there is no image', () => {
    render(<Avatar image={null} name="Ada Lovelace" size={128} />);
    const fallback = screen.getByRole('img', { name: 'Ada Lovelace' });
    expect(fallback).toHaveTextContent('AL');
    expect(screen.queryByTestId('img')).not.toBeInTheDocument();
  });
});
