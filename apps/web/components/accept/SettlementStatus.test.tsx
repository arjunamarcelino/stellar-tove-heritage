import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  trade: null as unknown,
  phase: 'polling' as string,
  refresh: vi.fn(),
}));
vi.mock('@/hooks/useTradePolling', () => ({
  useTradePolling: () => ({ trade: h.trade, phase: h.phase, refresh: h.refresh }),
}));

import SettlementStatus from '@/components/accept/SettlementStatus';
import { RFQ_ID, pendingTrade, settledTrade, failedTrade } from '@/test/fixtures/accept';

function renderStatus() {
  const onSettled = vi.fn();
  const onReAccept = vi.fn();
  const onAcceptAnother = vi.fn();
  render(
    <SettlementStatus
      rfqId={RFQ_ID}
      seedTrade={pendingTrade}
      onSettled={onSettled}
      onReAccept={onReAccept}
      onAcceptAnother={onAcceptAnother}
    />,
  );
  return { onSettled, onReAccept, onAcceptAnother };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.trade = pendingTrade;
  h.phase = 'polling';
});

describe('SettlementStatus', () => {
  it('pending → "still settling" hold with the poll phase hook', () => {
    renderStatus();
    expect(screen.getByText(/Settling your trade/)).toBeInTheDocument();
    expect(document.querySelector('[data-poll-phase="polling"]')).toBeInTheDocument();
  });

  it('settled → receipt with txHash link and calls onSettled (header re-read)', () => {
    h.trade = settledTrade;
    h.phase = 'settled';
    const { onSettled } = renderStatus();
    expect(screen.getByText('Trade complete')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View settlement on-chain/ })).toBeInTheDocument();
    expect(document.querySelector(`[data-tx-hash="${settledTrade.txHash}"]`)).toBeInTheDocument();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('failed + seller-fault → "Accept a different quote" (accept-another)', async () => {
    h.trade = failedTrade('seller_lockup');
    h.phase = 'failed';
    const { onAcceptAnother } = renderStatus();
    expect(document.querySelector('[data-failure-reason="seller_lockup"]')).toBeInTheDocument();
    expect(document.querySelector('[data-affordance="accept-another"]')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Accept a different quote/ }));
    expect(onAcceptAnother).toHaveBeenCalled();
  });

  it('failed + buyer/ambiguous → "Try accepting again" (re-accept)', async () => {
    h.trade = failedTrade('buyer_signature_expired');
    h.phase = 'failed';
    const { onReAccept } = renderStatus();
    expect(document.querySelector('[data-affordance="re-accept"]')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Try accepting again/ }));
    expect(onReAccept).toHaveBeenCalled();
  });

  it('error phase → "Check again" calls refresh', async () => {
    h.trade = pendingTrade;
    h.phase = 'error';
    renderStatus();
    await userEvent.click(screen.getByRole('button', { name: /Check again/ }));
    expect(h.refresh).toHaveBeenCalled();
  });
});
