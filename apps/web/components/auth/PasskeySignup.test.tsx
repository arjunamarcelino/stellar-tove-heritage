import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PasskeyEnrollState } from '@/lib/types/api';
import { fakeContractAddress } from '@/test/fixtures/passkey';

const h = vi.hoisted(() => ({
  detectPasskeySupport: vi.fn(),
  enroll: vi.fn(),
  retry: vi.fn(),
  reset: vi.fn(),
  replace: vi.fn(),
  state: { status: 'idle' } as PasskeyEnrollState,
  dialogSpy: vi.fn(),
}));

vi.mock('@/lib/webauthn/passkey', () => ({ detectPasskeySupport: h.detectPasskeySupport }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace }) }));
vi.mock('@/hooks/usePasskeyEnroll', () => ({
  usePasskeyEnroll: () => ({
    state: h.state,
    enroll: h.enroll,
    retry: h.retry,
    reset: h.reset,
  }),
}));
vi.mock('@/hooks/useWalletConnect', () => ({
  useWalletConnect: () => ({
    state: { status: 'idle' },
    providerId: null,
    publicKey: null,
    selectProvider: vi.fn(),
    sign: vi.fn(),
    requestManualChallenge: vi.fn(),
    verifyManualXdr: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock('@/components/wallet/WalletConnectDialog', () => ({
  default: (props: { isOpen: boolean }) => {
    h.dialogSpy(props.isOpen);
    return null;
  },
}));

import PasskeySignup from '@/components/auth/PasskeySignup';

beforeEach(() => {
  vi.clearAllMocks();
  h.state = { status: 'idle' };
  h.detectPasskeySupport.mockResolvedValue({ supported: true });
});

const passkeyCta = () => screen.queryByRole('button', { name: /create account with passkey/i });

describe('PasskeySignup — capability gate', () => {
  it('shows no CTA while capability detection is pending (no flash)', () => {
    h.detectPasskeySupport.mockReturnValue(new Promise(() => {}));
    render(<PasskeySignup />);
    expect(passkeyCta()).toBeNull();
    expect(screen.queryByRole('button', { name: /connect your own wallet/i })).toBeNull();
  });

  it('shows the passkey CTA when supported', async () => {
    render(<PasskeySignup />);
    expect(
      await screen.findByRole('button', { name: /create account with passkey/i }),
    ).toBeInTheDocument();
  });

  it('shows only the BYOW CTA when unsupported', async () => {
    h.detectPasskeySupport.mockResolvedValue({ supported: false });
    render(<PasskeySignup />);
    expect(
      await screen.findByRole('button', { name: /connect your own wallet/i }),
    ).toBeInTheDocument();
    expect(passkeyCta()).toBeNull();
  });
});

describe('PasskeySignup — interaction', () => {
  it('calls enroll with the entered email on submit', async () => {
    const user = userEvent.setup();
    render(<PasskeySignup />);
    const cta = await screen.findByRole('button', { name: /create account with passkey/i });
    await user.type(screen.getByLabelText(/email/i), 'leo@example.com');
    await user.click(cta);
    expect(h.enroll).toHaveBeenCalledWith('leo@example.com');
  });

  it('opens the wallet dialog when the BYOW CTA is clicked', async () => {
    const user = userEvent.setup();
    h.detectPasskeySupport.mockResolvedValue({ supported: false });
    render(<PasskeySignup />);
    const byow = await screen.findByRole('button', { name: /connect your own wallet/i });
    await user.click(byow);
    expect(h.dialogSpy).toHaveBeenLastCalledWith(true);
  });

  it('disables the CTA and shows progress copy while signing', async () => {
    h.state = { status: 'signing' };
    render(<PasskeySignup />);
    const cta = await screen.findByRole('button', { name: /face id|touch id|passkey/i });
    expect(cta).toBeDisabled();
  });

  it('renders EMAIL_CONFLICT error with a "Sign in instead" link and no retry', async () => {
    h.state = {
      status: 'error',
      code: 'EMAIL_CONFLICT',
      message: 'That email is already registered.',
    };
    render(<PasskeySignup />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/that email is already registered/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in instead/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('renders a retryable WALLET_DEPLOY_FAILED error whose "Try again" calls retry()', async () => {
    const user = userEvent.setup();
    h.state = {
      status: 'error',
      code: 'WALLET_DEPLOY_FAILED',
      message: "Couldn't create wallet.",
    };
    render(<PasskeySignup />);
    const tryAgain = await screen.findByRole('button', { name: /try again/i });
    await user.click(tryAgain);
    expect(h.retry).toHaveBeenCalled();
  });

  it('renders the success screen with the wallet address, explorer link and reassurance copy', () => {
    h.state = { status: 'success', contractAddress: fakeContractAddress };
    render(<PasskeySignup />);
    expect(screen.getByText(/account created/i)).toBeInTheDocument();
    expect(screen.getByText(/tove cannot move funds without your passkey/i)).toBeInTheDocument();
    // full address is in the title attribute; explorer link points at the testnet contract
    expect(screen.getByTitle(fakeContractAddress)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /stellar expert/i })).toHaveAttribute(
      'href',
      `https://stellar.expert/explorer/testnet/contract/${fakeContractAddress}`,
    );
  });

  it('navigates home when "Continue" is clicked on the success screen', async () => {
    const user = userEvent.setup();
    h.state = { status: 'success', contractAddress: fakeContractAddress };
    render(<PasskeySignup />);
    await user.click(screen.getByRole('button', { name: /continue to tove/i }));
    expect(h.replace).toHaveBeenCalledWith('/');
  });
});
