import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RfqConfirmation from '@/components/rfq/RfqConfirmation';
import { rfq, rfqWithWarning, expiredRfq } from '@/test/fixtures/rfq';

describe('RfqConfirmation', () => {
  it('renders the offer id, max price, and fraction count from the string fields', () => {
    render(<RfqConfirmation rfq={rfq} onMakeAnother={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /offer created/i })).toBeInTheDocument();
    expect(screen.getByText(/#7a9c0000/i)).toBeInTheDocument();
    expect(screen.getByText(/15\.00 USDC/)).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('shows a polite advisory balance hint when present, with required + available amounts', () => {
    render(<RfqConfirmation rfq={rfqWithWarning} onMakeAnother={vi.fn()} onDone={vi.fn()} />);
    const hint = screen.getByRole('status');
    expect(hint).toHaveTextContent(/heads up/i);
    expect(hint).toHaveTextContent('1,500.00'); // required (15,000,000,000 stroops)
    expect(hint).toHaveTextContent('500.00'); // available (5,000,000,000 stroops)
  });

  it('renders NO balance hint (and no solvency affirmation) when the warning is absent', () => {
    render(<RfqConfirmation rfq={rfq} onMakeAnother={vi.fn()} onDone={vi.fn()} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/sufficient/i)).not.toBeInTheDocument();
  });

  it('derives "Expired" client-side when expires_at is past (stored status stays open)', () => {
    render(<RfqConfirmation rfq={expiredRfq} onMakeAnother={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('wires the Make another / Done callbacks', () => {
    const onMakeAnother = vi.fn();
    const onDone = vi.fn();
    render(<RfqConfirmation rfq={rfq} onMakeAnother={onMakeAnother} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: /make another/i }));
    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(onMakeAnother).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
  });
});
