import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AcceptFlowState } from '@/hooks/useAcceptFlow';
import type { TradePollPhase } from '@/hooks/useTradePolling';

// Coordinator integration test (TOV-178 / FR-06.04). Mocks the two ceremony/poll hooks + passkey support so we
// can drive the RfqDetailPanel's mode swaps (list ↔ dialog ↔ settlement) and the on-settled RFQ re-read
// deterministically, without timers. The hooks themselves are unit-tested separately.
const h = vi.hoisted(() => ({
  acceptState: { status: 'preparing' } as AcceptFlowState,
  tradePhase: 'polling' as TradePollPhase,
  trade: null as unknown,
  acceptQuote: vi.fn(),
  sign: vi.fn(),
  rfqDetailAction: vi.fn(),
}));

vi.mock('@/hooks/useAcceptFlow', () => ({
  useAcceptFlow: () => ({
    state: h.acceptState,
    acceptQuote: h.acceptQuote,
    sign: h.sign,
    retry: vi.fn(),
    reconcile: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock('@/hooks/useTradePolling', () => ({
  useTradePolling: () => ({ trade: h.trade, phase: h.tradePhase, refresh: vi.fn() }),
}));
vi.mock('@/lib/webauthn/passkey', () => ({
  detectPasskeySupport: () => Promise.resolve({ supported: true }),
}));
vi.mock('@/app/actions/accept', () => ({ rfqDetailAction: h.rfqDetailAction }));

import RfqDetailPanel from '@/components/accept/RfqDetailPanel';
import { RFQ_ID, rfqDetail, pendingTrade, settledTrade } from '@/test/fixtures/accept';

beforeEach(() => {
  vi.clearAllMocks();
  h.acceptState = { status: 'preparing' };
  h.tradePhase = 'polling';
  h.trade = null;
  h.rfqDetailAction.mockResolvedValue({ status: 'success', rfq: rfqDetail });
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn();
});

describe('RfqDetailPanel coordinator', () => {
  it('starts on the list with the RFQ context header (data-panel-mode=list)', () => {
    render(<RfqDetailPanel rfqId={RFQ_ID} initialRfq={rfqDetail} seedTrade={null} />);
    expect(screen.getByRole('heading', { name: /Quotes on your request/ })).toBeInTheDocument();
    expect(document.querySelector('[data-panel-mode="list"]')).toBeInTheDocument();
    // Both fixture quotes render an Accept CTA (one acceptable, one not).
    expect(screen.getAllByRole('button', { name: 'Accept' }).length).toBe(2);
  });

  it('Accept → opens the dialog; a submitted handoff swaps to the settlement panel', async () => {
    // The dialog reports `submitted` as soon as it mounts (mocked hook), handing the trade up.
    h.acceptState = { status: 'submitted', trade: pendingTrade };
    h.trade = pendingTrade;
    render(<RfqDetailPanel rfqId={RFQ_ID} initialRfq={rfqDetail} seedTrade={null} />);

    // Click the acceptable row's CTA (the second row — price ASC puts the cheaper unacceptable one first).
    const acceptButtons = screen.getAllByRole('button', { name: 'Accept' });
    const enabled = acceptButtons.find((b) => !(b as HTMLButtonElement).disabled)!;
    await userEvent.click(enabled);

    // Coordinator swapped to the settlement panel; the list is gone.
    expect(document.querySelector('[data-poll-phase="polling"]')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });

  it('seeds straight into the settlement panel when a pending trade exists (reload-resume, AC-C)', () => {
    h.trade = pendingTrade;
    render(<RfqDetailPanel rfqId={RFQ_ID} initialRfq={rfqDetail} seedTrade={pendingTrade} />);
    expect(document.querySelector('[data-poll-phase="polling"]')).toBeInTheDocument();
    expect(document.querySelector('[data-panel-mode="settlement"]')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });

  it('disables Refresh while a refresh is in flight, then applies the fresh result (todo 176)', async () => {
    let resolve!: (v: unknown) => void;
    h.rfqDetailAction.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    render(<RfqDetailPanel rfqId={RFQ_ID} initialRfq={rfqDetail} seedTrade={null} />);

    const refreshBtn = screen.getByRole('button', { name: 'Refresh' });
    await userEvent.click(refreshBtn);
    expect(screen.getByRole('button', { name: /Refreshing/ })).toBeDisabled();

    await act(async () => {
      resolve({ status: 'success', rfq: { ...rfqDetail, status: 'filled' } });
    });
    expect(document.querySelector('[data-rfq-status="filled"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  it('on settled, re-reads the RFQ (header → Accepted, AC-A)', async () => {
    h.trade = settledTrade;
    h.tradePhase = 'settled';
    h.rfqDetailAction.mockResolvedValue({
      status: 'success',
      rfq: { ...rfqDetail, status: 'filled' },
    });
    await act(async () => {
      render(<RfqDetailPanel rfqId={RFQ_ID} initialRfq={rfqDetail} seedTrade={settledTrade} />);
    });
    expect(h.rfqDetailAction).toHaveBeenCalledWith(RFQ_ID);
    expect(document.querySelector('[data-rfq-status="filled"]')).toBeInTheDocument();
  });
});
