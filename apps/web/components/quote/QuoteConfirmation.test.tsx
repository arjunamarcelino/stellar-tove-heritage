import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import QuoteConfirmation from '@/components/quote/QuoteConfirmation';
import { quote, quoteCapped } from '@/test/fixtures/quote';

describe('QuoteConfirmation', () => {
  it('shows the quote id, price, count, and the BigInt-on-strings proceeds total; focuses the heading', () => {
    render(<QuoteConfirmation quote={quote} onSubmitAnother={vi.fn()} />);
    const heading = screen.getByRole('heading', { name: /quote submitted/i });
    expect(heading).toBe(document.activeElement); // focus landed on mount
    expect(screen.getByText('open')).toBeInTheDocument(); // status chip
    expect(screen.getByText(/#b1e20000/i)).toBeInTheDocument();
    expect(screen.getByText('15.00 USDC')).toBeInTheDocument(); // price per fraction
    expect(screen.getByText('375.00 USDC')).toBeInTheDocument(); // 150000000 × 25 = 3750000000 stroops
  });

  it('shows the capped notice only when validUntilCapped is set', () => {
    const { rerender } = render(<QuoteConfirmation quote={quote} onSubmitAnother={vi.fn()} />);
    expect(screen.queryByText(/shortened to be valid/i)).not.toBeInTheDocument();
    rerender(<QuoteConfirmation quote={quoteCapped} onSubmitAnother={vi.fn()} />);
    expect(screen.getByText(/shortened to be valid/i)).toBeInTheDocument();
  });

  it('exposes the full quote id via data-quote-id (the visible chip stays truncated)', () => {
    const { container } = render(<QuoteConfirmation quote={quote} onSubmitAnother={vi.fn()} />);
    expect(container.querySelector('[data-quote-id]')).toHaveAttribute('data-quote-id', quote.id);
  });

  it('binds the countdown to the server-returned validUntil (capped instant), not a client value', () => {
    render(<QuoteConfirmation quote={quoteCapped} onSubmitAnother={vi.fn()} />);
    // quoteCapped.validUntil = 2026-08-23 — the accessible name reflects the capped date.
    expect(screen.getByRole('timer')).toHaveTextContent(/Valid until August 23, 2026/i);
  });
});
