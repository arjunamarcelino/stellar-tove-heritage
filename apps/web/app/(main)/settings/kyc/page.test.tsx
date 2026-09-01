import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  getKycStatus: vi.fn(),
  getWhitelistStatus: vi.fn(),
  cookieStore: { get: vi.fn() },
  redirect: vi.fn(),
}));

vi.mock('@/lib/services/kyc', () => ({
  getKycStatus: h.getKycStatus,
  getWhitelistStatus: h.getWhitelistStatus,
}));
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue(h.cookieStore) }));
vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => {
    h.redirect(...args);
    throw new Error('REDIRECT');
  },
}));
vi.mock('@/components/kyc/KycWizard', () => ({
  default: ({ previouslyRejected }: { previouslyRejected?: boolean }) => (
    <div data-testid="wizard">rejected={String(previouslyRejected)}</div>
  ),
}));
vi.mock('@/components/kyc/KycStatusView', () => ({
  default: ({ variant }: { variant: string }) => <div data-testid="status">status {variant}</div>,
}));
// Card renders its own (client) subtree + polling; stub it here — the gate test only cares that the page
// wires the whitelist read into the card. The card has its own dedicated test.
vi.mock('@/components/kyc/WhitelistStatusCard', () => ({
  default: () => <div data-testid="whitelist-card" />,
}));

import KycPage from '@/app/(main)/settings/kyc/page';

beforeEach(() => {
  vi.clearAllMocks();
  h.cookieStore.get.mockReturnValue({ value: 'tok' });
  h.getWhitelistStatus.mockResolvedValue({ status: 'success', data: { status: 'not_submitted' } });
});

describe('KycPage gate', () => {
  it('redirects to login without a token and never reads status', async () => {
    h.cookieStore.get.mockReturnValue(undefined);
    await expect(KycPage()).rejects.toThrow('REDIRECT');
    expect(h.redirect).toHaveBeenCalledWith('/login');
    expect(h.getKycStatus).not.toHaveBeenCalled();
  });

  it('renders the wizard for not_submitted', async () => {
    h.getKycStatus.mockResolvedValue({
      status: 'success',
      kycStatus: 'not_submitted',
      latestSubmission: null,
    });
    render(await KycPage());
    expect(screen.getByTestId('wizard')).toHaveTextContent('rejected=false');
    // The whitelist card coexists above the submission flow (both reads render).
    expect(screen.getByTestId('whitelist-card')).toBeInTheDocument();
  });

  it('flags previouslyRejected for a rejected status', async () => {
    h.getKycStatus.mockResolvedValue({
      status: 'success',
      kycStatus: 'rejected',
      latestSubmission: null,
    });
    render(await KycPage());
    expect(screen.getByTestId('wizard')).toHaveTextContent('rejected=true');
  });

  it('renders the pending status view (not the form) for pending_review', async () => {
    h.getKycStatus.mockResolvedValue({
      status: 'success',
      kycStatus: 'pending_review',
      latestSubmission: null,
    });
    render(await KycPage());
    expect(screen.getByTestId('status')).toHaveTextContent('status pending');
    expect(screen.queryByTestId('wizard')).toBeNull();
  });

  it('renders the approved status view for approved', async () => {
    h.getKycStatus.mockResolvedValue({
      status: 'success',
      kycStatus: 'approved',
      latestSubmission: null,
    });
    render(await KycPage());
    expect(screen.getByTestId('status')).toHaveTextContent('status approved');
  });

  it('shows an error banner when the status read fails', async () => {
    h.getKycStatus.mockResolvedValue({ status: 'error', code: 'SERVER_ERROR', message: 'nope' });
    render(await KycPage());
    expect(screen.getByRole('alert')).toHaveTextContent('nope');
  });
});
