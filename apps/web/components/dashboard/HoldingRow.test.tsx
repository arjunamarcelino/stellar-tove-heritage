import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element -- test mock stands in for next/image
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import HoldingRow from '@/components/dashboard/HoldingRow';
import type { Holding } from '@/lib/types/api';
import { makeHolding } from '@/test/fixtures/holdings';

function renderRow(overrides: Partial<Holding> = {}) {
  return render(
    <ul>
      <HoldingRow holding={makeHolding(overrides)} />
    </ul>,
  );
}

describe('HoldingRow', () => {
  it('shows the balance without a locked annotation and enables Sell when free_balance > 0', () => {
    renderRow({ balance: '60', lockedBalance: '0', freeBalance: '60' });
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(screen.queryByText(/locked/i)).toBeNull();
    expect(screen.getByRole('link', { name: /sell \(rfq\)/i })).toHaveAttribute(
      'href',
      expect.stringContaining('/rfq/new'),
    );
  });

  it('renders "· 40 locked" and keeps Sell enabled on a partial lock, with a word-form accessible name', () => {
    renderRow({ balance: '100', lockedBalance: '40', freeBalance: '60' });
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText(/·\s*40 locked/)).toBeInTheDocument();
    expect(screen.getByText('100 fractions, 40 locked')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sell \(rfq\)/i })).toBeInTheDocument();
  });

  it('disables Sell via aria-disabled (not native disabled) when fully locked', () => {
    renderRow({ balance: '60', lockedBalance: '60', freeBalance: '0' });
    const sell = screen.getByRole('button', { name: /sell \(rfq\)/i });
    expect(sell).toHaveAttribute('aria-disabled', 'true');
    expect(sell).not.toHaveAttribute('disabled');
    expect(sell.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByRole('link', { name: /view artwork/i })).toHaveAttribute(
      'href',
      expect.stringContaining('/a/'),
    );
  });

  it('fully locked → disabled-Sell reason claims the lock (matches the visual annotation)', () => {
    renderRow({ balance: '60', lockedBalance: '60', freeBalance: '0' });
    expect(screen.getByText('All fractions locked — nothing to sell.')).toBeInTheDocument();
  });

  it('free=0 without a full lock → neutral reason, no false "locked" claim', () => {
    renderRow({ balance: '60', lockedBalance: '0', freeBalance: '0' });
    expect(screen.queryByText(/locked/i)).toBeNull();
    expect(screen.getByText('No fractions available to sell.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sell \(rfq\)/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('renders title-only when the artist handle is missing', () => {
    renderRow({ artistHandle: null });
    expect(screen.getByText('Sunrise over the Estuary')).toBeInTheDocument();
    expect(screen.queryByText('@monet')).toBeNull();
  });

  it('falls back to an initials placeholder when the image URL is null (no <img> mounted)', () => {
    renderRow({ artworkImageUrl: null });
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('SO')).toBeInTheDocument();
  });
});
