import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { offering } from '@/test/fixtures/offerings';
import type { Offering } from '@/lib/types/api';

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element -- test mock stands in for next/image
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import OfferingHeader from '@/components/offering/OfferingHeader';

describe('OfferingHeader', () => {
  it('renders the title and a price-band ledger (formatted USDC range)', () => {
    render(<OfferingHeader offering={offering} uiState="biddable" />);
    expect(screen.getByRole('heading', { name: /untitled no\. 7/i })).toBeInTheDocument();
    // band [50M, 150M] stroops → 5.00–15.00 USDC
    expect(screen.getByText(/5\.00–15\.00 USDC/)).toBeInTheDocument();
    expect(screen.getByText(/1000000 fractions/)).toBeInTheDocument();
  });

  it('collapses a degenerate band (low === high) into "Fixed at N USDC"', () => {
    const fixed: Offering = { ...offering, highPriceStroops: offering.lowPriceStroops };
    render(<OfferingHeader offering={fixed} uiState="biddable" />);
    expect(screen.getByText(/Fixed at 5\.00 USDC/)).toBeInTheDocument();
  });

  it('biddable → an "Open" chip (ochre tone, not green/red)', () => {
    render(<OfferingHeader offering={offering} uiState="biddable" />);
    const chip = screen.getByText('Open');
    expect(chip.className).toMatch(/ochre/);
    expect(chip.className).not.toMatch(/emerald|rose|red|green/);
  });

  it('coming-soon → "Opens soon" (charcoal, neutral)', () => {
    render(<OfferingHeader offering={offering} uiState="coming-soon" />);
    expect(screen.getByText('Opens soon').className).toMatch(/charcoal/);
  });

  it('canceled → "Canceled" chip on the sienna destructive tone', () => {
    render(<OfferingHeader offering={offering} uiState="canceled" />);
    expect(screen.getByText('Canceled').className).toMatch(/sienna/);
  });

  it('closed → "Closed" chip (neutral)', () => {
    render(<OfferingHeader offering={offering} uiState="closed" />);
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });
});
