import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { offering, prepareData } from '@/test/fixtures/offerings';
import type { Bid, Offering } from '@/lib/types/api';
import type { BidFlowState } from '@/hooks/useBidFlow';
import type { BidPollPhase } from '@/hooks/useMyBidPolling';

const h = vi.hoisted(() => ({
  flow: {
    state: { status: 'idle' } as BidFlowState,
    placeBid: vi.fn(),
    sign: vi.fn(),
    retry: vi.fn(),
    reconcile: vi.fn(),
    reset: vi.fn(),
  },
  detect: vi.fn(),
  poll: { bid: null as Bid | null, phase: 'polling' as BidPollPhase, refresh: vi.fn() },
  onSubmitted: vi.fn(),
}));

vi.mock('@/hooks/useBidFlow', () => ({ useBidFlow: () => h.flow }));
vi.mock('@/lib/webauthn/passkey', () => ({ detectPasskeySupport: () => h.detect() }));
vi.mock('@/hooks/useMyBidPolling', () => ({ useMyBidPolling: () => h.poll }));

import BidPanel from '@/components/offering/BidPanel';

function renderPanel(state: BidFlowState = { status: 'idle' }, offr: Offering = offering) {
  h.flow.state = state;
  return render(<BidPanel offering={offr} onSubmitted={h.onSubmitted} />);
}

beforeEach(() => {
  h.flow.state = { status: 'idle' };
  h.flow.placeBid = vi.fn();
  h.flow.sign = vi.fn();
  h.flow.retry = vi.fn();
  h.flow.reconcile = vi.fn();
  h.detect = vi.fn().mockResolvedValue({ supported: true });
  h.poll = { bid: null, phase: 'polling', refresh: vi.fn() };
  h.onSubmitted = vi.fn();
});

describe('BidPanel', () => {
  it('renders the form once a passkey-capable device is detected', async () => {
    renderPanel();
    expect(await screen.findByLabelText(/price per fraction/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/fractions/i)).toBeInTheDocument();
  });

  it('"You pay" = price × count in USDC (price 10 USDC × 10 → 100.00 USDC)', async () => {
    renderPanel();
    const price = await screen.findByLabelText(/price per fraction/i);
    fireEvent.change(price, { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/fractions/i), { target: { value: '10' } });
    // 100000000 stroops × 10 = 1,000,000,000 stroops = 100.00 USDC
    expect(screen.getByRole('button', { name: /place bid · 100\.00 usdc/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /place bid/i }));
    expect(h.flow.placeBid).toHaveBeenCalledWith(offering.id, {
      price: '100000000',
      count: 10,
    });
  });

  it('shows the stroops read-out mirroring the authoritative USDC input', async () => {
    renderPanel();
    const price = await screen.findByLabelText(/price per fraction/i);
    fireEvent.change(price, { target: { value: '10' } });
    expect(screen.getByText(/= 100000000 stroops/)).toBeInTheDocument();
  });

  it('accepts a sub-USDC price ("0.5") without rejecting it (band permitting)', async () => {
    const subUsdcBand: Offering = { ...offering, lowPriceStroops: '5000000' }; // 0.5 USDC floor
    renderPanel({ status: 'idle' }, subUsdcBand);
    const price = await screen.findByLabelText(/price per fraction/i);
    fireEvent.change(price, { target: { value: '0.5' } });
    expect(screen.getByText(/= 5000000 stroops/)).toBeInTheDocument();
    // Not rejected as invalid / too-precise / out-of-band.
    expect(screen.queryByText(/valid USDC amount/i)).toBeNull();
    expect(screen.queryByText(/decimal places/i)).toBeNull();
    expect(screen.queryByText(/price between/i)).toBeNull();
  });

  it('low === high → a fixed read-only price (no input, no slider)', async () => {
    const fixed: Offering = { ...offering, highPriceStroops: offering.lowPriceStroops };
    renderPanel({ status: 'idle' }, fixed);
    await waitFor(() => expect(screen.getByText(/\(fixed\)/i)).toBeInTheDocument());
    expect(screen.queryByRole('textbox')).toBeNull(); // no price text input
  });

  it('unsupported device → the unsupported gate, no form', async () => {
    h.detect = vi.fn().mockResolvedValue({ supported: false });
    renderPanel();
    expect(await screen.findByText(/passkey-capable device/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/price per fraction/i)).toBeNull();
  });

  it('WALLET_NOT_FOUND error → the enrol (no-passkey) gate', async () => {
    renderPanel({
      status: 'error',
      code: 'WALLET_NOT_FOUND',
      message: 'x',
      retry: 'none',
    });
    expect(await screen.findByRole('link', { name: /enrol a passkey/i })).toBeInTheDocument();
  });

  it('insufficientBalance → interpolates the Zod-validated required/available amounts', async () => {
    renderPanel({
      status: 'insufficientBalance',
      required: '1000000000', // 100.00 USDC
      available: '250000000', // 25.00 USDC
      message: 'fallback',
    });
    expect(
      await screen.findByText(/Need 100\.00 USDC, you have 25\.00 USDC\./i),
    ).toBeInTheDocument();
  });

  it('readyToSign → a "Sign with passkey" step that fires the passkey from THIS gesture', async () => {
    renderPanel({ status: 'readyToSign', data: prepareData });
    const signBtn = await screen.findByRole('button', { name: /sign with passkey/i });
    fireEvent.click(signBtn);
    expect(h.flow.sign).toHaveBeenCalledTimes(1);
  });

  it('readyToSign → "You pay" shows the SERVER escrow amount, not a client recompute (todo 148)', async () => {
    // prepareData.escrowAmountStroops = "1000000000" → 100.00 USDC.
    renderPanel({ status: 'readyToSign', data: prepareData });
    const youPay = await screen.findByText(/^100\.00$/);
    expect(youPay).toBeInTheDocument();
  });

  it('submitted → hands the bid UP to the parent (which owns ActiveBidCard) and renders nothing itself', async () => {
    const submittedBid: Bid = {
      id: 'b',
      offeringId: offering.id,
      price: '100000000',
      count: 10,
      escrowAmountStroops: '1000000000',
      status: 'submitted',
      chainBidId: null,
      escrowTxHash: null,
      createdAt: '2026-08-20T10:00:00.000Z',
    };
    const { container } = renderPanel({ status: 'submitted', bid: submittedBid });
    // The handoff fires via effect; BidPanel renders nothing (no nested poll) — the parent swaps in ActiveBidCard.
    await waitFor(() => expect(h.onSubmitted).toHaveBeenCalledWith(submittedBid));
    expect(container).toBeEmptyDOMElement();
  });

  it('sessionExpired → inline re-auth prompt linking to /login (entries preserved while mounted)', async () => {
    renderPanel({ status: 'sessionExpired' });
    expect(await screen.findByText('Session expired')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });

  it('error with retry:"reprepare" → a "Try again" button calling the hook retry', async () => {
    renderPanel({
      status: 'error',
      code: 'BID_CHALLENGE_EXPIRED',
      message: 'Your signing window timed out. Please try again.',
      retry: 'reprepare',
    });
    const btn = await screen.findByRole('button', { name: /try again/i });
    fireEvent.click(btn);
    expect(h.flow.retry).toHaveBeenCalledTimes(1);
  });
});
