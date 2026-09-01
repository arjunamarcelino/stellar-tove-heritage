import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import QuoteGateCta from '@/components/quote/QuoteGateCta';

describe('QuoteGateCta', () => {
  it('anon → sign-in CTA to /login', () => {
    render(<QuoteGateCta reason="anon" />);
    expect(screen.getByText(/sign in to submit a quote/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });

  it('not-whitelisted → complete-KYC CTA to /settings/kyc', () => {
    render(<QuoteGateCta reason="not-whitelisted" />);
    expect(screen.getByText(/complete kyc to submit a quote/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /complete kyc/i })).toHaveAttribute(
      'href',
      '/settings/kyc',
    );
  });
});
