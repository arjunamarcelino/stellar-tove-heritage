import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { rfq } from '@/test/fixtures/rfq';
import type { RfqFlowState } from '@/hooks/useCreateRfq';

const h = vi.hoisted(() => ({
  state: { status: 'idle' } as RfqFlowState,
  submit: vi.fn(),
  retry: vi.fn(),
  makeAnother: vi.fn(),
}));

vi.mock('@/hooks/useCreateRfq', () => ({
  useCreateRfq: () => ({
    state: h.state,
    submit: h.submit,
    retry: h.retry,
    makeAnother: h.makeAnother,
  }),
}));
vi.mock('@/app/actions/rfqs', () => ({ createRfqAction: vi.fn() }));

import RfqPanel from '@/components/rfq/RfqPanel';

const ARTWORK = 'a1230000-0000-4000-8000-000000000001';

beforeEach(() => {
  vi.clearAllMocks();
  h.state = { status: 'idle' };
});

describe('RfqPanel', () => {
  it('starts collapsed with a "Make an offer" CTA (aria-expanded=false) and expands the form on click', () => {
    render(<RfqPanel artworkId={ARTWORK} />);
    const cta = screen.getByRole('button', { name: /make an offer/i });
    expect(cta).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText(/number of fractions/i)).not.toBeInTheDocument();

    fireEvent.click(cta);
    expect(screen.getByLabelText(/number of fractions/i)).toBeInTheDocument();
  });

  it('returns focus to the "Make an offer" trigger on Cancel (WCAG 2.4.3)', () => {
    render(<RfqPanel artworkId={ARTWORK} />);
    const cta = screen.getByRole('button', { name: /make an offer/i });
    fireEvent.click(cta);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByRole('button', { name: /make an offer/i })).toBe(document.activeElement);
  });

  it('submitting → form inputs disabled and the button reads "Sending…"', () => {
    h.state = { status: 'submitting' };
    render(<RfqPanel artworkId={ARTWORK} />);
    fireEvent.click(screen.getByRole('button', { name: /make an offer/i }));
    expect(screen.getByLabelText(/number of fractions/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /sending/i })).toBeDisabled();
    // Cancel is disabled while submitting so an in-flight create can't be abandoned (todo 157).
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
  });

  it('created → renders the confirmation, hides the form', () => {
    h.state = { status: 'created', rfq };
    render(<RfqPanel artworkId={ARTWORK} />);
    fireEvent.click(screen.getByRole('button', { name: /make an offer/i }));
    expect(screen.getByRole('heading', { name: /offer created/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/number of fractions/i)).not.toBeInTheDocument();
  });

  it('terminal error → role=alert with a Try again that calls retry (same-key)', () => {
    h.state = { status: 'error', code: 'RFQ_TOO_MANY_ACTIVE', message: 'max reached' };
    render(<RfqPanel artworkId={ARTWORK} />);
    fireEvent.click(screen.getByRole('button', { name: /make an offer/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/max reached/i);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(h.retry).toHaveBeenCalledOnce();
  });

  it('RFQ_NOT_WHITELISTED → a Complete KYC affordance, not a re-failing "Try again"', () => {
    h.state = { status: 'error', code: 'RFQ_NOT_WHITELISTED', message: 'complete kyc' };
    render(<RfqPanel artworkId={ARTWORK} />);
    fireEvent.click(screen.getByRole('button', { name: /make an offer/i }));
    expect(screen.getByRole('link', { name: /complete kyc/i })).toHaveAttribute(
      'href',
      '/settings/kyc',
    );
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('ARTWORK_NOT_FOUND → an alert with no "Try again" (a retry would re-fail)', () => {
    h.state = { status: 'error', code: 'ARTWORK_NOT_FOUND', message: 'not found' };
    render(<RfqPanel artworkId={ARTWORK} />);
    fireEvent.click(screen.getByRole('button', { name: /make an offer/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/not found/i);
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('IN_FLIGHT → polite role=status advisory (not an alert)', () => {
    h.state = { status: 'error', code: 'IDEMPOTENCY_KEY_IN_FLIGHT', message: 'still processing' };
    render(<RfqPanel artworkId={ARTWORK} />);
    fireEvent.click(screen.getByRole('button', { name: /make an offer/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/still processing/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('SESSION_EXPIRED → alert with a Sign in link, form stays mounted (values survive)', () => {
    h.state = { status: 'error', code: 'SESSION_EXPIRED', message: 'session expired' };
    render(<RfqPanel artworkId={ARTWORK} />);
    fireEvent.click(screen.getByRole('button', { name: /make an offer/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/session expired/i);
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
    expect(screen.getByLabelText(/number of fractions/i)).toBeInTheDocument();
  });
});
