import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { quote } from '@/test/fixtures/quote';
import type { QuoteFlowState } from '@/hooks/useSubmitQuote';

const h = vi.hoisted(() => ({
  state: { status: 'idle' } as QuoteFlowState,
  submit: vi.fn(),
  retry: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('@/hooks/useSubmitQuote', () => ({
  useSubmitQuote: () => ({ state: h.state, submit: h.submit, retry: h.retry, reset: h.reset }),
}));
vi.mock('@/app/actions/quotes', () => ({ submitQuoteAction: vi.fn() }));

import QuotePanel from '@/components/quote/QuotePanel';

const RFQ = '7a9c0000-0000-4000-8000-000000000001';

beforeEach(() => {
  vi.clearAllMocks();
  h.state = { status: 'idle' };
});

describe('QuotePanel', () => {
  it('renders the form at idle', () => {
    render(<QuotePanel rfqId={RFQ} />);
    expect(screen.getByLabelText(/fractions to sell/i)).toBeInTheDocument();
  });

  it('while submitting: shows a polite "Checking your fraction balance…" status region', () => {
    h.state = { status: 'submitting' };
    render(<QuotePanel rfqId={RFQ} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/checking your fraction balance/i);
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('on 201 → the confirmation (form gone)', () => {
    h.state = { status: 'created', quote };
    render(<QuotePanel rfqId={RFQ} />);
    expect(screen.getByRole('heading', { name: /quote submitted/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/fractions to sell/i)).not.toBeInTheDocument();
  });

  it('INSUFFICIENT → inline advisory with the numbers, form stays live, NO retry button', () => {
    h.state = {
      status: 'error',
      code: 'QUOTE_INSUFFICIENT_FREE_BALANCE',
      message: 'not enough',
      balanceDetail: { requiredFractionCount: '25', freeFractionCount: '5' },
    };
    render(<QuotePanel rfqId={RFQ} />);
    expect(screen.getByText(/only 5/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/fractions to sell/i)).toBeInTheDocument(); // form still there
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('QUOTE_ALREADY_OPEN → reassuring copy + escape link, NO retry, focus-managed (no role=alert)', () => {
    h.state = { status: 'error', code: 'QUOTE_ALREADY_OPEN', message: 'you already have one' };
    render(<QuotePanel rfqId={RFQ} />);
    expect(screen.getByText(/you already have one/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // focus replaces the live role (C8)
  });

  it('QUOTE_BALANCE_UNAVAILABLE (503) → a Try again button that calls retry()', () => {
    h.state = {
      status: 'error',
      code: 'QUOTE_BALANCE_UNAVAILABLE',
      message: 'balance read failed',
    };
    render(<QuotePanel rfqId={RFQ} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(h.retry).toHaveBeenCalledTimes(1);
  });

  it('IDEMPOTENCY_KEY_IN_FLIGHT → a POLITE status advisory with retry (not focus-stealing)', () => {
    h.state = { status: 'error', code: 'IDEMPOTENCY_KEY_IN_FLIGHT', message: 'still processing' };
    render(<QuotePanel rfqId={RFQ} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/still processing/i);
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('QUOTE_NOT_WHITELISTED → the KYC gate CTA (no retry)', () => {
    h.state = { status: 'error', code: 'QUOTE_NOT_WHITELISTED', message: 'kyc' };
    render(<QuotePanel rfqId={RFQ} />);
    expect(screen.getByRole('link', { name: /complete kyc/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('moves focus to the error container on a terminal (non-in-flight) error', () => {
    h.state = { status: 'error', code: 'SERVER_ERROR', message: 'oops' };
    render(<QuotePanel rfqId={RFQ} />);
    const container = screen.getByText('oops').closest('[tabindex="-1"]');
    expect(container).toBe(document.activeElement);
  });

  it('exposes machine-readable data-quote-state / data-error-code hooks on the panel root', () => {
    h.state = { status: 'error', code: 'QUOTE_RFQ_EXPIRED', message: 'expired' };
    const { container } = render(<QuotePanel rfqId={RFQ} />);
    const root = container.querySelector('[data-quote-state]');
    expect(root).toHaveAttribute('data-quote-state', 'error');
    expect(root).toHaveAttribute('data-error-code', 'QUOTE_RFQ_EXPIRED');
  });
});
