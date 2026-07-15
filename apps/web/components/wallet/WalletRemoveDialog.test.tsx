import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { fakeAddedByowWallet } from '@/test/fixtures/walletExport';

const h = vi.hoisted(() => ({ removeWalletAction: vi.fn() }));
vi.mock('@/app/actions/walletManage', () => ({ removeWalletAction: h.removeWalletAction }));

import WalletRemoveDialog from '@/components/wallet/WalletRemoveDialog';

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

function renderDialog(overrides: Partial<Parameters<typeof WalletRemoveDialog>[0]> = {}) {
  const props = {
    wallet: fakeAddedByowWallet,
    onResolved: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<WalletRemoveDialog {...props} />);
  return props;
}

describe('WalletRemoveDialog', () => {
  it('removes the wallet and calls onResolved on success', async () => {
    h.removeWalletAction.mockResolvedValue({ status: 'success', newPrimaryWalletId: null });
    const { onResolved } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /remove wallet/i }));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(h.removeWalletAction).toHaveBeenCalledWith(fakeAddedByowWallet.id);
  });

  it('cancels without calling the action', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(h.removeWalletAction).not.toHaveBeenCalled();
  });

  it('shows a retriable error in an alert and stays open', async () => {
    h.removeWalletAction.mockResolvedValue({
      status: 'error',
      code: 'SERVER_ERROR',
      message: 'Something went wrong on our end. Please try again.',
    });
    const { onResolved } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /remove wallet/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(onResolved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('resolves (closes + refresh) on a stale-list PRIMARY_WALLET_CANNOT_BE_REMOVED race, not an error view', async () => {
    h.removeWalletAction.mockResolvedValue({
      status: 'error',
      code: 'PRIMARY_WALLET_CANNOT_BE_REMOVED',
      message: 'You can’t remove your primary wallet.',
    });
    const { onResolved } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /remove wallet/i }));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
