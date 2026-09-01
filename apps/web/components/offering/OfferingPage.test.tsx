import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { offering, submittedBid } from '@/test/fixtures/offerings';
import type { BidFlowState } from '@/hooks/useBidFlow';
import type { Offering } from '@/lib/types/api';

// The page's children lean on client hooks — stub them so the gate matrix is isolated from ceremony/poll
// machinery (each is exercised in its own test). `flowState` is mutable so a test can drive BidPanel to
// `submitted` and verify the placed-bid handoff (todo 146).
const h = vi.hoisted(() => ({ flowState: { status: 'idle' } as BidFlowState }));
vi.mock('@/hooks/useBidFlow', () => ({
  useBidFlow: () => ({
    state: h.flowState,
    placeBid: vi.fn(),
    sign: vi.fn(),
    retry: vi.fn(),
    reconcile: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock('@/lib/webauthn/passkey', () => ({
  detectPasskeySupport: () => Promise.resolve({ supported: true }),
}));
vi.mock('@/hooks/useMyBidPolling', () => ({
  useMyBidPolling: () => ({ bid: null, phase: 'polling', refresh: vi.fn() }),
}));
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element -- test mock stands in for next/image
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import OfferingPage from '@/components/offering/OfferingPage';

// Real-clock-independent uiStates: past-open + far-future-close is unambiguously biddable; status-driven
// states (planned/settled/canceled) don't depend on the window at all.
const biddable: Offering = {
  ...offering,
  status: 'opened',
  windowOpenAt: '2000-01-01T00:00:00.000Z',
  windowCloseAt: '2999-01-01T00:00:00.000Z',
};
const comingSoon: Offering = { ...offering, status: 'planned' };
const closed: Offering = { ...offering, status: 'settled' };
const canceled: Offering = { ...offering, status: 'canceled' };

beforeEach(() => {
  h.flowState = { status: 'idle' };
});

describe('OfferingPage gate matrix', () => {
  it('always renders the header (title) for every viewer', () => {
    render(
      <OfferingPage
        offering={biddable}
        initialUiState="biddable"
        initialBid={null}
        isWhitelisted
        isSignedIn
      />,
    );
    expect(screen.getByRole('heading', { name: /untitled no\. 7/i })).toBeInTheDocument();
  });

  it('anonymous, biddable → the "Sign in to bid" gate', () => {
    render(
      <OfferingPage
        offering={biddable}
        initialUiState="biddable"
        initialBid={null}
        isWhitelisted={false}
        isSignedIn={false}
      />,
    );
    expect(screen.getByText(/sign in to bid/i)).toBeInTheDocument();
  });

  it('signed-in but not whitelisted, biddable → the "Complete verification" gate', () => {
    render(
      <OfferingPage
        offering={biddable}
        initialUiState="biddable"
        initialBid={null}
        isWhitelisted={false}
        isSignedIn
      />,
    );
    expect(screen.getByRole('link', { name: /complete kyc/i })).toBeInTheDocument();
  });

  it('signed-in + whitelisted + biddable → the BidPanel form', async () => {
    render(
      <OfferingPage
        offering={biddable}
        initialUiState="biddable"
        initialBid={null}
        isWhitelisted
        isSignedIn
      />,
    );
    expect(await screen.findByLabelText(/price per fraction/i)).toBeInTheDocument();
  });

  it('coming-soon → a status message, no form', () => {
    render(
      <OfferingPage
        offering={comingSoon}
        initialUiState="coming-soon"
        initialBid={null}
        isWhitelisted
        isSignedIn
      />,
    );
    expect(screen.getByText(/not open yet/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/price per fraction/i)).toBeNull();
  });

  it('closed (settled) → a "settled" status message', () => {
    render(
      <OfferingPage
        offering={closed}
        initialUiState="closed"
        initialBid={null}
        isWhitelisted
        isSignedIn
      />,
    );
    expect(screen.getByText(/offering settled/i)).toBeInTheDocument();
  });

  it('canceled → a "canceled" status message', () => {
    render(
      <OfferingPage
        offering={canceled}
        initialUiState="canceled"
        initialBid={null}
        isWhitelisted
        isSignedIn
      />,
    );
    expect(screen.getByText(/offering canceled/i)).toBeInTheDocument();
  });

  it('has an active bid → the ActiveBidCard, form hidden (one active bid per collector)', () => {
    render(
      <OfferingPage
        offering={biddable}
        initialUiState="biddable"
        initialBid={submittedBid}
        isWhitelisted
        isSignedIn
      />,
    );
    expect(screen.getByText(/escrowing/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/price per fraction/i)).toBeNull();
  });

  it('a bid placed live in-session survives the window closing (todo 146)', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2100-06-01T00:00:00.000Z'));
      h.flowState = { status: 'submitted', bid: submittedBid };
      const closing: Offering = {
        ...offering,
        status: 'opened',
        windowOpenAt: '2000-01-01T00:00:00.000Z',
        windowCloseAt: '2100-06-01T00:00:05.000Z', // 5s after "now" → biddable at render
      };
      render(
        <OfferingPage
          offering={closing}
          initialUiState="biddable"
          initialBid={null}
          isWhitelisted
          isSignedIn
        />,
      );
      // Flush the passkey-detect microtask + the onSubmitted handoff effect → ActiveBidCard mounts.
      // (No waitFor — it polls on faked timers and would deadlock.)
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText(/escrowing/i)).toBeInTheDocument();

      // Advance past windowCloseAt → the 1s uiState recompute flips to 'closed'.
      await act(async () => {
        vi.setSystemTime(new Date('2100-06-01T00:00:06.000Z'));
        vi.advanceTimersByTime(1100);
      });

      // The placed bid still wins — ActiveBidCard stays; NOT the "closed" message.
      expect(screen.getByText(/escrowing/i)).toBeInTheDocument();
      expect(screen.queryByText(/no longer accepting bids/i)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
