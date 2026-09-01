import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import QuoteCountdown from '@/components/quote/QuoteCountdown';

describe('QuoteCountdown', () => {
  it('a future validUntil renders a live "Valid for" timer with a static absolute-date accessible name', () => {
    render(<QuoteCountdown validUntil="2099-01-01T00:00:00.000Z" />);
    const timer = screen.getByRole('timer');
    expect(timer).toHaveTextContent(/valid for/i);
    expect(timer).toHaveTextContent(/Valid until January 1, 2099/i);
    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
  });

  it('a past validUntil renders "Expired" (derived client-side, no sweeper)', () => {
    render(<QuoteCountdown validUntil="2020-01-01T00:00:00.000Z" />);
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });
});
