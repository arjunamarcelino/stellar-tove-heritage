import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AcceptFlowState } from '@/hooks/useAcceptFlow';

const h = vi.hoisted(() => ({
  state: { status: 'preparing' } as AcceptFlowState,
  acceptQuote: vi.fn(),
  sign: vi.fn(),
  retry: vi.fn(),
  reconcile: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('@/hooks/useAcceptFlow', () => ({
  useAcceptFlow: () => ({
    state: h.state,
    acceptQuote: h.acceptQuote,
    sign: h.sign,
    retry: h.retry,
    reconcile: h.reconcile,
    reset: h.reset,
  }),
}));

import AcceptDialog from '@/components/accept/AcceptDialog';
import { RFQ_ID, openQuote, prepareAcceptData, pendingTrade } from '@/test/fixtures/accept';

// jsdom doesn't implement <dialog> showModal/close — stub them, and toggle the `open` attribute so the dialog
// subtree is visible in the accessibility tree (a closed <dialog> is display:none, so getByRole would skip it).
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  h.state = { status: 'preparing' };
});

function renderDialog() {
  const onSubmitted = vi.fn();
  const onStale = vi.fn();
  const onClose = vi.fn();
  render(
    <AcceptDialog
      rfqId={RFQ_ID}
      quote={openQuote}
      onSubmitted={onSubmitted}
      onStale={onStale}
      onClose={onClose}
    />,
  );
  return { onSubmitted, onStale, onClose };
}

describe('AcceptDialog', () => {
  it('kicks off prepare on mount (gesture 1) and exposes data-accept-state', () => {
    renderDialog();
    expect(h.acceptQuote).toHaveBeenCalledWith(RFQ_ID, openQuote);
    expect(document.querySelector('[data-accept-state="preparing"]')).toBeInTheDocument();
  });

  it('readyToSign → renders the 1.5/1.5 fee breakdown and a Sign button (gesture 2)', async () => {
    h.state = { status: 'readyToSign', data: prepareAcceptData };
    renderDialog();
    expect(screen.getByText('You pay (gross)')).toBeInTheDocument();
    expect(screen.getByText('1,000.00 USDC')).toBeInTheDocument(); // gross
    expect(screen.getByText('Platform fee (1.5%)')).toBeInTheDocument();
    expect(screen.getByText('Artist royalty (1.5%)')).toBeInTheDocument();

    const signBtn = screen.getByRole('button', { name: /Sign with passkey/ });
    expect(signBtn).toHaveAttribute('data-requires-user-gesture'); // human-only boundary (todo 180)
    await userEvent.click(signBtn);
    expect(h.sign).toHaveBeenCalled();
  });

  it('submitted → closes the dialog (focus return) then hands the pending trade up (todo 184)', () => {
    h.state = { status: 'submitted', trade: pendingTrade };
    const { onSubmitted } = renderDialog();
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    expect(onSubmitted).toHaveBeenCalledWith(pendingTrade);
  });

  it('staleQuote → closes the dialog (focus return) then signals a list re-fetch (todo 184)', () => {
    h.state = { status: 'staleQuote' };
    const { onStale } = renderDialog();
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  it('error → surfaces the code + affordance via data-* (todo 180) and offers a retry', () => {
    h.state = { status: 'error', code: 'SERVER_ERROR', message: 'boom', retry: 'reprepare' };
    renderDialog();
    expect(document.querySelector('[data-error-code="SERVER_ERROR"]')).toBeInTheDocument();
    expect(document.querySelector('[data-affordance="retry"]')).toBeInTheDocument();
  });
});
