import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import OfferingSkeleton from '@/components/offering/OfferingSkeleton';

describe('OfferingSkeleton', () => {
  it('announces loading once via role="status"', () => {
    render(<OfferingSkeleton />);
    expect(screen.getByRole('status', { name: /loading offering/i })).toBeInTheDocument();
  });

  it('marks the shimmer as aria-hidden (no double announcement)', () => {
    const { container } = render(<OfferingSkeleton />);
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
  });
});
