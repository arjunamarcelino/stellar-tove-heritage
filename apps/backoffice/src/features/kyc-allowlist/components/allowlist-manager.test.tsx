import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/features/auth/hooks/use-auth', () => ({ useAuth: vi.fn() }));
vi.mock('../hooks/use-allowlist-queries', () => ({ useWalletStatus: vi.fn() }));
vi.mock('../hooks/use-allowlist-mutations', () => ({ useAllowlistAction: vi.fn() }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

import { toast } from 'sonner';

import { useAuth } from '@/features/auth/hooks/use-auth';

import { useAllowlistAction } from '../hooks/use-allowlist-mutations';
import { useWalletStatus } from '../hooks/use-allowlist-queries';
import { AllowlistManager } from './allowlist-manager';

const WALLET = 'C' + 'A'.repeat(55);

const confirmedResult = {
  wallet: WALLET,
  action: 'add' as const,
  status: 'confirmed' as const,
  isAllowed: true,
  txHash: 'a'.repeat(64),
  errorReason: null,
};

const mockedAuth = vi.mocked(useAuth);
const mockedStatus = vi.mocked(useWalletStatus);
const mockedAction = vi.mocked(useAllowlistAction);

function setRole(role: 'admin' | 'superadmin') {
  mockedAuth.mockReturnValue({
    user: { role },
    isLoading: false,
    isAuthenticated: true,
  } as unknown as ReturnType<typeof useAuth>);
}

function lookUp(wallet: string) {
  fireEvent.change(screen.getByLabelText('Collector wallet'), { target: { value: wallet } });
  fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
}

describe('AllowlistManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedStatus.mockReturnValue({
      data: { status: 'whitelisted', wallet: WALLET },
      isFetching: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useWalletStatus>);
    mockedAction.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useAllowlistAction>);
    setRole('superadmin');
  });

  it('hides the pill/actions until a valid wallet is looked up (positive)', () => {
    render(<AllowlistManager />);
    expect(screen.queryByRole('button', { name: 'Add to allowlist' })).not.toBeInTheDocument();

    lookUp(WALLET);
    expect(screen.getByText('Whitelisted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to allowlist' })).toBeInTheDocument();
  });

  it('shows Remove for superadmin, hides it for admin (edge — RBAC)', () => {
    const { unmount } = render(<AllowlistManager />);
    lookUp(WALLET);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    unmount();

    setRole('admin');
    render(<AllowlistManager />);
    lookUp(WALLET);
    expect(screen.getByRole('button', { name: 'Add to allowlist' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('rejects a G… account with a tailored message and no lookup (negative)', () => {
    render(<AllowlistManager />);
    lookUp('G' + 'A'.repeat(55));
    expect(screen.getByRole('alert')).toHaveTextContent(/account \(G…\)/i);
    expect(screen.queryByRole('button', { name: 'Add to allowlist' })).not.toBeInTheDocument();
  });

  it('warns and never keeps a pasted secret key on change (edge — security)', () => {
    render(<AllowlistManager />);
    // Secret is caught on change/paste — no Look-up click needed; the field is cleared immediately.
    fireEvent.change(screen.getByLabelText('Collector wallet'), {
      target: { value: 'S' + 'A'.repeat(55) },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/never paste a secret/i);
    expect(screen.getByLabelText('Collector wallet')).toHaveValue('');
  });

  it('clears the committed lookup when the input is edited (edge — stale-lookup guard)', () => {
    render(<AllowlistManager />);
    lookUp(WALLET);
    expect(screen.getByRole('button', { name: 'Add to allowlist' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Collector wallet'), { target: { value: WALLET + 'X' } });
    expect(screen.queryByRole('button', { name: 'Add to allowlist' })).not.toBeInTheDocument();
  });

  it('confirm Add → calls mutate and shows a success toast with a tx link (positive — confirm flow)', async () => {
    const mutate = vi.fn((_vars, opts?: { onSuccess?: (r: unknown) => void }) =>
      opts?.onSuccess?.({ kind: 'processed', result: confirmedResult }),
    );
    mockedAction.mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<
      typeof useAllowlistAction
    >);

    render(<AllowlistManager />);
    lookUp(WALLET);
    fireEvent.click(screen.getByRole('button', { name: 'Add to allowlist' })); // open dialog
    const form = screen.getByLabelText('Reason (optional)').closest('form');
    if (!form) throw new Error('dialog form not found');
    fireEvent.submit(form); // submit dialog (RHF handleSubmit → onConfirm, async)

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      'Wallet added to the allowlist',
      expect.objectContaining({ action: expect.objectContaining({ label: 'View tx' }) }),
    );
  });

  it('confirm Add → 409 conflict shows an info toast, not an error (edge — confirm flow)', async () => {
    const mutate = vi.fn((_vars, opts?: { onSuccess?: (r: unknown) => void }) =>
      opts?.onSuccess?.({ kind: 'conflict', reason: 'in_flight' }),
    );
    mockedAction.mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<
      typeof useAllowlistAction
    >);

    render(<AllowlistManager />);
    lookUp(WALLET);
    fireEvent.click(screen.getByRole('button', { name: 'Add to allowlist' }));
    const form = screen.getByLabelText('Reason (optional)').closest('form');
    if (!form) throw new Error('dialog form not found');
    fireEvent.submit(form);

    await waitFor(() =>
      expect(vi.mocked(toast.message)).toHaveBeenCalledWith(expect.stringMatching(/still processing/i)),
    );
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });
});
