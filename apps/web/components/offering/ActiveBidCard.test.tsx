import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { submittedBid, escrowedBid, failedBid, OFFERING_ID } from '@/test/fixtures/offerings';
import type { Bid } from '@/lib/types/api';
import type { BidPollPhase } from '@/hooks/useMyBidPolling';

const h = vi.hoisted(() => ({
  value: { bid: null as Bid | null, phase: 'polling' as BidPollPhase, refresh: vi.fn() },
}));
vi.mock('@/hooks/useMyBidPolling', () => ({
  useMyBidPolling: () => h.value,
}));

import ActiveBidCard from '@/components/offering/ActiveBidCard';

function renderWith(bid: Bid, phase: BidPollPhase) {
  h.value = { bid, phase, refresh: h.value.refresh };
  return render(<ActiveBidCard offeringId={OFFERING_ID} initialBid={bid} />);
}

beforeEach(() => {
  h.value = { bid: null, phase: 'polling', refresh: vi.fn() };
});

describe('ActiveBidCard', () => {
  it('polling → "Escrowing…" on the neutral (charcoal) tone', () => {
    const { container } = renderWith(submittedBid, 'polling');
    expect(screen.getByText(/escrowing/i)).toBeInTheDocument();
    // Neutral tone — never green/red.
    expect(container.innerHTML).not.toMatch(/emerald|rose-|text-red|bg-red|green/);
  });

  it('settled → "Bid placed" on the ochre accent tone, with a truncated escrow-tx receipt', () => {
    const { container } = renderWith(escrowedBid, 'settled');
    expect(screen.getByText(/bid placed/i)).toBeInTheDocument();
    // Success rides on ochre (TONE_ACCENT), never emerald/green.
    const card = container.querySelector('.border-ochre\\/40');
    expect(card).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/emerald|green/);
    // Middle-truncated hash (…) so both ends stay legible.
    expect(screen.getByText(/…/)).toBeInTheDocument();
  });

  it('failed → "Bid failed — No funds were moved" on the sienna destructive tone (not red)', () => {
    const { container } = renderWith(failedBid, 'failed');
    expect(screen.getByText(/bid failed — no funds were moved/i)).toBeInTheDocument();
    const card = container.querySelector('.border-sienna\\/50');
    expect(card).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/text-red|bg-red|rose-|emerald|green/);
  });

  it('timeout → "Still settling" with a working Refresh affordance', () => {
    renderWith(submittedBid, 'timeout');
    expect(screen.getByText(/still settling/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(h.value.refresh).toHaveBeenCalledTimes(1);
  });

  it('error → neutral "couldn’t confirm" with a Refresh', () => {
    renderWith(submittedBid, 'error');
    expect(screen.getByText(/couldn’t confirm/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(h.value.refresh).toHaveBeenCalledTimes(1);
  });

  it('announces coarse transitions via a polite sr-only status region', () => {
    renderWith(submittedBid, 'polling');
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
