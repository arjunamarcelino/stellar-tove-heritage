import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import BidGateCta from '@/components/offering/BidGateCta';

describe('BidGateCta', () => {
  it('anon → "Sign in" CTA linking to /login', () => {
    render(<BidGateCta reason="anon" />);
    expect(screen.getByText(/sign in to bid/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });

  it('not-whitelisted → "Complete KYC" CTA deep-linking to /settings/kyc', () => {
    render(<BidGateCta reason="not-whitelisted" />);
    expect(screen.getByRole('link', { name: /complete kyc/i })).toHaveAttribute(
      'href',
      '/settings/kyc',
    );
  });

  it('no-passkey → "Enrol a passkey" CTA linking to /settings', () => {
    render(<BidGateCta reason="no-passkey" />);
    expect(screen.getByRole('link', { name: /enrol a passkey/i })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('unsupported → honest explanation with NO CTA (no dead button)', () => {
    render(<BidGateCta reason="unsupported" />);
    expect(screen.getByText(/passkey-capable device/i)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
