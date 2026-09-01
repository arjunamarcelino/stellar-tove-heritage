import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RfqGateCta from '@/components/rfq/RfqGateCta';

describe('RfqGateCta', () => {
  it('anon → "Sign in to make offers" linking to /login', () => {
    render(<RfqGateCta reason="anon" />);
    expect(screen.getByText(/sign in to make offers/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });

  it('not-whitelisted → "Complete KYC to make offers" deep-linking to /settings/kyc', () => {
    render(<RfqGateCta reason="not-whitelisted" />);
    expect(screen.getByText(/complete kyc to make offers/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /complete kyc/i })).toHaveAttribute(
      'href',
      '/settings/kyc',
    );
  });
});
