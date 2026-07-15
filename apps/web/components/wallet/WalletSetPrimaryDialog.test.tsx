import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { fakeAddedByowWallet, fakePrimaryWallet } from '@/test/fixtures/walletExport';
import { truncateAddress } from '@/lib/wallet/format';

const h = vi.hoisted(() => ({ setPrimaryWalletAction: vi.fn() }));
vi.mock('@/app/actions/walletManage', () => ({ setPrimaryWalletAction: h.setPrimaryWalletAction }));

import WalletSetPrimaryDialog from '@/components/wallet/WalletSetPrimaryDialog';

// jsdom implements neither showModal nor close on <dialog>; stub them. showModal must set `open` or
// the dialog stays display:none and its contents are hidden from role queries.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

beforeEach(() => vi.clearAllMocks());

function renderDialog(overrides: Partial<Parameters<typeof WalletSetPrimaryDialog>[0]> = {}) {
  const props = {
    wallet: fakeAddedByowWallet,
    currentPrimary: fakePrimaryWallet,
    onResolved: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<WalletSetPrimaryDialog {...props} />);
  return props;
}

describe('WalletSetPrimaryDialog', () => {
  it('sets the wallet as primary and calls onResolved on success', async () => {
    h.setPrimaryWalletAction.mockResolvedValue({ status: 'success' });
    const { onResolved } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /set as primary/i }));
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(true)); // didPromote → panel announces
    expect(h.setPrimaryWalletAction).toHaveBeenCalledWith(fakeAddedByowWallet.id);
  });

  it('cancels without calling the action', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(h.setPrimaryWalletAction).not.toHaveBeenCalled();
  });

  it('shows a retriable error in an alert and stays open', async () => {
    h.setPrimaryWalletAction.mockResolvedValue({
      status: 'error',
      code: 'SERVER_ERROR',
      message: 'Something went wrong on our end. Please try again.',
    });
    const { onResolved } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /set as primary/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(onResolved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('resolves (closes + refresh) on a stale-list WALLET_NOT_ELIGIBLE_FOR_PRIMARY race, not an error view', async () => {
    h.setPrimaryWalletAction.mockResolvedValue({
      status: 'error',
      code: 'WALLET_NOT_ELIGIBLE_FOR_PRIMARY',
      message: 'This wallet can’t be set as primary.',
    });
    const { onResolved } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /set as primary/i }));
    // Resolved as a stale-list correction (didPromote=false → no success announcement), not an error.
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(false));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('resolves on an already-gone WALLET_NOT_FOUND race, not an error view', async () => {
    h.setPrimaryWalletAction.mockResolvedValue({
      status: 'error',
      code: 'WALLET_NOT_FOUND',
      message: 'That wallet is no longer available.',
    });
    const { onResolved } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /set as primary/i }));
    // didPromote=false (nothing changed) so the panel won't falsely announce a promote.
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(false));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('names both the incoming and outgoing primary addresses when currentPrimary is passed', () => {
    renderDialog();
    expect(screen.getByText(truncateAddress(fakeAddedByowWallet.address))).toBeInTheDocument();
    expect(screen.getByText(truncateAddress(fakePrimaryWallet.address))).toBeInTheDocument();
  });

  it('uses the default dialog role, not alertdialog (neutral, reversible action)', () => {
    renderDialog();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
