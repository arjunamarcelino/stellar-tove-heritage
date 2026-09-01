import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { useOfferings, useNowMs } = vi.hoisted(() => ({ useOfferings: vi.fn(), useNowMs: vi.fn() }));
vi.mock('../hooks/use-offering-queries', () => ({ useOfferings }));
vi.mock('@/hooks/use-countdown', () => ({ useNowMs }));

import { OfferingCountdownCard } from './offering-countdown-card';

const NOW = Date.parse('2026-09-01T00:00:00.000Z');

function approvedOffering(windowOpenAt: string) {
  return {
    id: 'offering-1',
    artworkId: 'a1',
    status: 'approved',
    lowPriceStroops: '1000000',
    highPriceStroops: '5000000',
    publicFloat: '800000',
    windowOpenAt,
    windowCloseAt: '2026-09-08T00:00:00.000Z',
    attestedArtistAddress: null,
    escrow: { deployStatus: 'deployed', contractAddress: 'C' + 'A'.repeat(55) },
    approvals: { count: 2, threshold: 2, youApproved: true },
  };
}

describe('OfferingCountdownCard', () => {
  beforeEach(() => {
    useOfferings.mockReset();
    useNowMs.mockReset().mockReturnValue(NOW);
  });

  it('renders a countdown to windowOpenAt for each approved offering', () => {
    useOfferings.mockReturnValue({ data: { data: [approvedOffering('2026-09-01T01:30:00.000Z')] } });
    render(<OfferingCountdownCard />);
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toBeInTheDocument();
  });

  it('shows "Window open" once the window has passed', () => {
    useOfferings.mockReturnValue({ data: { data: [approvedOffering('2026-08-31T23:00:00.000Z')] } });
    render(<OfferingCountdownCard />);
    expect(screen.getByText('Window open')).toBeInTheDocument();
  });

  it('renders nothing when there are no approved offerings', () => {
    useOfferings.mockReturnValue({ data: { data: [] } });
    const { container } = render(<OfferingCountdownCard />);
    expect(container).toBeEmptyDOMElement();
  });
});
