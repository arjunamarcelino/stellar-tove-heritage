import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RfqCountdown from '@/components/rfq/RfqCountdown';

describe('RfqCountdown', () => {
  it('a future expiry renders a live "Expires in" timer with a static absolute-date accessible name', () => {
    render(<RfqCountdown expiresAt="2099-01-01T00:00:00.000Z" />);
    const timer = screen.getByRole('timer');
    expect(timer).toHaveTextContent(/expires in/i);
    // The accessible name is the static absolute date (sr-only), not the ticking digits.
    expect(timer).toHaveTextContent(/Expires January 1, 2099/i);
    // Regression (todo 155): a future target must never render the "Expired" terminal state.
    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
  });

  it('a past expiry renders "Expired" (derived client-side)', () => {
    render(<RfqCountdown expiresAt="2020-01-01T00:00:00.000Z" />);
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });
});
