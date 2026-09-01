import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WalletTrustlineDialog from '@/components/wallet/WalletTrustlineDialog';
import { fakeAddedByowWallet } from '@/test/fixtures/walletExport';
import type { WalletTrustlineState } from '@/lib/types/api';

// Control the hook: each test sets `hook.state` before render and asserts the panel / spy calls.
const hook = vi.hoisted(() => ({
  state: { status: 'idle' } as WalletTrustlineState,
  start: vi.fn(),
  sign: vi.fn(),
  recheck: vi.fn(),
  retry: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('@/hooks/useWalletTrustline', () => ({
  useWalletTrustline: () => hook,
}));

const ASSET = { code: 'USDC', issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' };

// jsdom implements neither showModal nor close; polyfill so the dialog contents render.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  hook.state = { status: 'idle' };
});

function renderDialog() {
  const onDone = vi.fn();
  const onSkip = vi.fn();
  const utils = render(
    <WalletTrustlineDialog
      wallet={fakeAddedByowWallet}
      asset={ASSET}
      onDone={onDone}
      onSkip={onSkip}
    />,
  );
  return { ...utils, onDone, onSkip };
}

describe('WalletTrustlineDialog', () => {
  it('idle: shows the explainer, provider buttons, and Skip; picking a provider calls start', async () => {
    const user = userEvent.setup();
    renderDialog();
    expect(screen.getByRole('heading', { name: /add usdc trustline/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /freighter/i }));
    expect(hook.start).toHaveBeenCalledWith('freighter');
    expect(screen.getByRole('button', { name: /skip for now/i })).toBeInTheDocument();
  });

  it('skip on idle calls onSkip', async () => {
    const user = userEvent.setup();
    const { onSkip } = renderDialog();
    await user.click(screen.getByRole('button', { name: /skip for now/i }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('readyToSign: the CTA triggers sign', async () => {
    hook.state = { status: 'readyToSign', asset: ASSET };
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /^add usdc trustline$/i }));
    expect(hook.sign).toHaveBeenCalledTimes(1);
  });

  it('blockedUnfunded: recheck button triggers recheck', async () => {
    hook.state = { status: 'blockedUnfunded', address: fakeAddedByowWallet.address };
    const user = userEvent.setup();
    renderDialog();
    expect(screen.getByText(/never been funded/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /recheck/i }));
    expect(hook.recheck).toHaveBeenCalledTimes(1);
  });

  it('blockedLowReserve: shows the exact shortfall', () => {
    hook.state = { status: 'blockedLowReserve', shortfallXlm: '0.5' };
    renderDialog();
    expect(screen.getByText(/0\.5 more XLM/i)).toBeInTheDocument();
  });

  it('success: Done calls reset + onDone', async () => {
    hook.state = { status: 'success', hash: 'HASH' };
    const user = userEvent.setup();
    const { onDone } = renderDialog();
    await user.click(screen.getByRole('button', { name: /done/i }));
    expect(hook.reset).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('error (retry-sign): Try again triggers retry', async () => {
    hook.state = {
      status: 'error',
      code: 'USER_CANCELLED',
      message: 'Signing was cancelled.',
      recovery: 'retry-sign',
    };
    const user = userEvent.setup();
    renderDialog();
    expect(screen.getByRole('alert')).toHaveTextContent(/cancelled/i);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(hook.retry).toHaveBeenCalledTimes(1);
  });

  it('is not dismissible while signing (no Skip button, cancel prevented)', () => {
    hook.state = { status: 'signing' };
    renderDialog();
    expect(screen.queryByRole('button', { name: /skip for now/i })).not.toBeInTheDocument();
    // Firing the dialog's cancel event while locked must not call onSkip.
    const dialog = document.querySelector('dialog')!;
    const evt = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
  });
});
