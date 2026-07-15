import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  fakeEmbeddedWallet,
  fakeByowWallet,
  fakeExportedWallet,
  fakePrimaryWallet,
  fakeAddedByowWallet,
  fakeExportedByowWallet,
} from '@/test/fixtures/walletExport';

const h = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }));
// Stub the dialogs so the panel test doesn't mount the native <dialog>/hooks. WalletRow is left real
// so the trailing-action controls it renders are exercised through the panel. The set-primary stub is
// controllable: it exposes buttons that call onResolved(true|false) so the panel's resolve handling
// (announcement + refresh) can be driven from the test.
vi.mock('@/components/wallet/WalletExportDialog', () => ({ default: () => null }));
vi.mock('@/components/wallet/WalletRemoveDialog', () => ({ default: () => null }));
vi.mock('@/components/wallet/WalletAddDialog', () => ({ default: () => null }));
vi.mock('@/components/wallet/WalletSetPrimaryDialog', () => ({
  default: ({ onResolved }: { onResolved: (didPromote: boolean) => void }) => (
    <div>
      <button data-testid="stub-resolve-promote" onClick={() => onResolved(true)}>
        promote
      </button>
      <button data-testid="stub-resolve-race" onClick={() => onResolved(false)}>
        race
      </button>
    </div>
  ),
}));

import WalletSettingsPanel, { promoteInList } from '@/components/wallet/WalletSettingsPanel';

beforeEach(() => vi.clearAllMocks());

describe('promoteInList (optimistic single-primary transform)', () => {
  it('flips isPrimary onto the promoted wallet and off every other', () => {
    const result = promoteInList([fakePrimaryWallet, fakeAddedByowWallet], fakeAddedByowWallet.id);
    const primaries = result.filter((w) => w.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.id).toBe(fakeAddedByowWallet.id);
    expect(result.find((w) => w.id === fakePrimaryWallet.id)?.isPrimary).toBe(false);
  });

  it('does not mutate the input wallets', () => {
    const input = [fakePrimaryWallet, fakeAddedByowWallet];
    promoteInList(input, fakeAddedByowWallet.id);
    expect(fakePrimaryWallet.isPrimary).toBe(true); // fixture untouched
  });
});

describe('WalletSettingsPanel', () => {
  it('shows the export CTA for an active embedded wallet', () => {
    render(<WalletSettingsPanel wallets={[fakeEmbeddedWallet]} />);
    expect(screen.getByRole('button', { name: /export to self-custody/i })).toBeInTheDocument();
  });

  it('shows the exported badge and no CTA for an exported wallet', () => {
    render(<WalletSettingsPanel wallets={[fakeExportedWallet]} />);
    expect(screen.getByText(/wallet exported/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /export to self-custody/i })).toBeNull();
  });

  it('offers no export and no set-primary for a BYOW wallet with unknown primary status', () => {
    render(<WalletSettingsPanel wallets={[fakeByowWallet]} />);
    expect(screen.queryByRole('button', { name: /export to self-custody/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /set .* as primary/i })).toBeNull();
    // The misleading "Already self-custodied" copy is removed (todo 083).
    expect(screen.queryByText(/already self-custodied/i)).toBeNull();
  });

  it('renders an empty state with an Add-wallet entry when there are no wallets', () => {
    render(<WalletSettingsPanel wallets={[]} />);
    expect(screen.getByText(/no wallets on your account/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add wallet/i })).toBeInTheDocument();
  });

  it('always shows the Add-wallet button', () => {
    render(<WalletSettingsPanel wallets={[fakePrimaryWallet]} />);
    expect(screen.getByRole('button', { name: /add wallet/i })).toBeInTheDocument();
  });

  it('shows a read-only Primary badge and the added date for the primary wallet', () => {
    render(<WalletSettingsPanel wallets={[fakePrimaryWallet]} />);
    expect(screen.getByText(/primary/i)).toBeInTheDocument();
    expect(screen.getByText(/added/i)).toBeInTheDocument();
  });

  it('shows no Primary badge when isPrimary is absent (forward-compat)', () => {
    render(<WalletSettingsPanel wallets={[fakeByowWallet]} />);
    expect(screen.queryByText(/primary/i)).toBeNull();
  });

  it('shows a Remove control only for a non-primary BYOW wallet', () => {
    render(<WalletSettingsPanel wallets={[fakeAddedByowWallet]} />);
    expect(screen.getByRole('button', { name: /remove wallet/i })).toBeInTheDocument();
  });

  it('shows no Remove control for the primary wallet', () => {
    render(<WalletSettingsPanel wallets={[fakePrimaryWallet]} />);
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
  });

  it('shows no Remove control when isPrimary is unknown (forward-compat BYOW)', () => {
    // fakeByowWallet has no isPrimary → treated as unknown → not removable.
    render(<WalletSettingsPanel wallets={[fakeByowWallet]} />);
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
  });

  it('shows no Remove control for an embedded wallet (export path instead)', () => {
    render(<WalletSettingsPanel wallets={[fakeEmbeddedWallet]} />);
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
    expect(screen.getByRole('button', { name: /export to self-custody/i })).toBeInTheDocument();
  });

  it('shows a Set-as-primary control only for a non-primary, non-exported BYOW wallet', () => {
    render(<WalletSettingsPanel wallets={[fakeAddedByowWallet]} />);
    expect(screen.getByRole('button', { name: /set .* as primary/i })).toBeInTheDocument();
  });

  it('shows no Set-as-primary control for the primary wallet', () => {
    render(<WalletSettingsPanel wallets={[fakePrimaryWallet]} />);
    expect(screen.queryByRole('button', { name: /set .* as primary/i })).toBeNull();
  });

  it('shows no Set-as-primary control for an exported BYOW wallet (badge wins)', () => {
    render(<WalletSettingsPanel wallets={[fakeExportedByowWallet]} />);
    expect(screen.queryByRole('button', { name: /set .* as primary/i })).toBeNull();
    expect(screen.getByText(/wallet exported/i)).toBeInTheDocument();
  });

  it('renders exactly one Primary badge across a mixed list', () => {
    render(<WalletSettingsPanel wallets={[fakePrimaryWallet, fakeAddedByowWallet]} />);
    expect(screen.getAllByText(/★ primary/i)).toHaveLength(1);
    expect(screen.getByRole('button', { name: /set .* as primary/i })).toBeInTheDocument();
  });

  it('renders a persistent status live region for success announcements', () => {
    const { container } = render(<WalletSettingsPanel wallets={[fakePrimaryWallet]} />);
    const status = container.querySelector('[role="status"]');
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent('');
  });

  it('announces the promoted wallet (state assertion) in the live region on success', () => {
    const { container } = render(
      <WalletSettingsPanel wallets={[fakePrimaryWallet, fakeAddedByowWallet]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /set .* as primary/i }));
    fireEvent.click(screen.getByTestId('stub-resolve-promote'));
    const status = container.querySelector('[role="status"]');
    expect(status).toHaveTextContent(/is now your primary wallet/i);
    // Truthful state assertion, not a change claim ("updated").
    expect(status).not.toHaveTextContent(/updated/i);
  });

  it('does not announce on a stale-list race resolve (didPromote=false)', () => {
    const { container } = render(
      <WalletSettingsPanel wallets={[fakePrimaryWallet, fakeAddedByowWallet]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /set .* as primary/i }));
    fireEvent.click(screen.getByTestId('stub-resolve-race'));
    expect(container.querySelector('[role="status"]')).toHaveTextContent('');
  });

  it('refreshes the list on every resolve — including a race (didPromote=false)', () => {
    // The discard-DTO design is only safe because every resolve refreshes; pin that coupling.
    render(<WalletSettingsPanel wallets={[fakePrimaryWallet, fakeAddedByowWallet]} />);
    fireEvent.click(screen.getByRole('button', { name: /set .* as primary/i }));
    fireEvent.click(screen.getByTestId('stub-resolve-race'));
    expect(h.refresh).toHaveBeenCalled();
  });
});
