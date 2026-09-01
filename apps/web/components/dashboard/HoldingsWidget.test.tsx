import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { HoldingsResult } from '@/lib/types/api';
import { makeHolding } from '@/test/fixtures/holdings';

const h = vi.hoisted(() => ({
  refreshHoldingsAction: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('@/app/actions/holdings', () => ({ refreshHoldingsAction: h.refreshHoldingsAction }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace }) }));
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element -- test mock stands in for next/image
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import HoldingsWidget from '@/components/dashboard/HoldingsWidget';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HoldingsWidget', () => {
  it('renders the "Your fractions" heading', () => {
    render(<HoldingsWidget initial={{ status: 'success', holdings: [], droppedCount: 0 }} />);
    expect(screen.getByRole('heading', { name: /your fractions/i })).toBeInTheDocument();
  });

  it('renders one row per holding', () => {
    const initial: HoldingsResult = {
      status: 'success',
      holdings: [
        makeHolding({ tokenContract: 'C1', artworkTitle: 'One' }),
        makeHolding({ tokenContract: 'C2', artworkTitle: 'Two' }),
      ],
      droppedCount: 0,
    };
    render(<HoldingsWidget initial={initial} />);
    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
  });

  it('shows a "couldn’t be shown" notice when rows were dropped, alongside surviving rows', () => {
    const initial: HoldingsResult = {
      status: 'success',
      holdings: [makeHolding({ artworkTitle: 'Survivor' })],
      droppedCount: 2,
    };
    render(<HoldingsWidget initial={initial} />);
    expect(screen.getByText(/2 holdings couldn’t be shown/i)).toBeInTheDocument();
    expect(screen.getByText('Survivor')).toBeInTheDocument();
  });

  it('renders the empty state with a browse CTA and no Retry', () => {
    render(<HoldingsWidget initial={{ status: 'success', holdings: [], droppedCount: 0 }} />);
    expect(screen.getByText(/don’t hold any fractions/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse artworks/i })).toHaveAttribute(
      'href',
      '/artworks',
    );
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('shows an error message with a working Retry that re-renders rows', async () => {
    h.refreshHoldingsAction.mockResolvedValue({
      status: 'success',
      holdings: [makeHolding({ artworkTitle: 'Recovered' })],
      droppedCount: 0,
    });
    render(<HoldingsWidget initial={{ status: 'error', code: 'SERVER_ERROR', message: 'Boom' }} />);
    expect(screen.getByText('Boom')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(h.refreshHoldingsAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('Recovered')).toBeInTheDocument());
  });

  it('flips to the empty state when a retry returns no holdings', async () => {
    h.refreshHoldingsAction.mockResolvedValue({ status: 'success', holdings: [], droppedCount: 0 });
    render(<HoldingsWidget initial={{ status: 'error', code: 'SERVER_ERROR', message: 'Boom' }} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByText(/don’t hold any fractions/i)).toBeInTheDocument());
  });

  it('redirects to /login when a retry returns SESSION_EXPIRED (no loop)', async () => {
    h.refreshHoldingsAction.mockResolvedValue({
      status: 'error',
      code: 'SESSION_EXPIRED',
      message: 'expired',
    });
    render(<HoldingsWidget initial={{ status: 'error', code: 'SERVER_ERROR', message: 'Boom' }} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/login'));
  });
});
