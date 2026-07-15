import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WalletRow from '@/components/wallet/WalletRow';
import { truncateAddress } from '@/lib/wallet/format';
import {
  fakeEmbeddedWallet,
  fakeExportedWallet,
  fakeByowWallet,
  fakePrimaryWallet,
  fakeAddedByowWallet,
  fakeExportedByowWallet,
} from '@/test/fixtures/walletExport';
import type { WalletSummary } from '@/lib/types/api';

// A primary BYOW wallet — the only shape that hits the "Primary wallet" trailing-text branch.
// (fakePrimaryWallet is an EMBEDDED primary, which by the truth table renders the export CTA, so it
// can't exercise the byow/primary/false → "Primary wallet" row.)
const fakePrimaryByowWallet: WalletSummary = { ...fakeAddedByowWallet, isPrimary: true };

// WalletRow returns an <li>, so wrap it in a <ul> for valid DOM.
function renderRow(wallet: WalletSummary, isPending = false) {
  const onExport = vi.fn();
  const onRemove = vi.fn();
  const onSetPrimary = vi.fn();
  const utils = render(
    <ul>
      <WalletRow
        wallet={wallet}
        isPending={isPending}
        onExport={onExport}
        onRemove={onRemove}
        onSetPrimary={onSetPrimary}
      />
    </ul>,
  );
  return { ...utils, onExport, onRemove, onSetPrimary };
}

describe('WalletRow trailing element', () => {
  // Table-driven: each fixture renders exactly one trailing element (the right one).
  const cases: Array<{ name: string; wallet: WalletSummary; expected: RegExp }> = [
    { name: 'embedded (active)', wallet: fakeEmbeddedWallet, expected: /export to self-custody/i },
    { name: 'exported embedded', wallet: fakeExportedWallet, expected: /wallet exported/i },
    { name: 'byow undefined-primary', wallet: fakeByowWallet, expected: /^$/ },
    // fakePrimaryWallet is an embedded primary → export CTA (per truth table), not "Primary wallet".
    { name: 'primary embedded', wallet: fakePrimaryWallet, expected: /export to self-custody/i },
    { name: 'primary byow', wallet: fakePrimaryByowWallet, expected: /primary wallet/i },
    { name: 'eligible byow', wallet: fakeAddedByowWallet, expected: /set as primary/i },
    { name: 'exported byow', wallet: fakeExportedByowWallet, expected: /wallet exported/i },
  ];

  it.each(cases)('renders the right trailing element for $name', ({ wallet, expected }) => {
    renderRow(wallet);
    if (expected.source === '^$') {
      // byow/undefined/false: no trailing control at all.
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByText(/wallet exported/i)).toBeNull();
      expect(screen.queryByText(/primary wallet/i)).toBeNull();
    } else {
      expect(screen.getByText(expected)).toBeInTheDocument();
    }
  });
});

describe('WalletRow eligibility', () => {
  it('shows BOTH "Set as primary" and "Remove" for an eligible non-primary, non-exported BYOW', () => {
    renderRow(fakeAddedByowWallet);
    expect(screen.getByRole('button', { name: /set .* as primary/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove wallet/i })).toBeInTheDocument();
  });

  it('shows the ★ Primary badge for the primary wallet (embedded → export CTA trailing)', () => {
    renderRow(fakePrimaryWallet);
    expect(screen.getByText(/★ Primary/)).toBeInTheDocument();
    // Embedded primary: badge in the header, export CTA trailing (per the truth table).
    expect(screen.getByRole('button', { name: /export to self-custody/i })).toBeInTheDocument();
  });

  it('shows the ★ Primary badge and "Primary wallet" text for a primary BYOW wallet, no controls', () => {
    renderRow(fakePrimaryByowWallet);
    expect(screen.getByText(/★ Primary/)).toBeInTheDocument();
    expect(screen.getByText(/primary wallet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set .* as primary/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
  });

  it('shows no set-primary, no "already self-custodied", no remove for undefined-primary BYOW', () => {
    renderRow(fakeByowWallet);
    expect(screen.queryByRole('button', { name: /set .* as primary/i })).toBeNull();
    expect(screen.queryByText(/already self-custodied/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
  });

  it('shows the exported badge and no set-primary for an exported BYOW', () => {
    renderRow(fakeExportedByowWallet);
    expect(screen.getByText(/✓ Wallet exported/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set .* as primary/i })).toBeNull();
  });

  it('shows the export CTA and no remove/set-primary for an embedded wallet', () => {
    renderRow(fakeEmbeddedWallet);
    expect(screen.getByRole('button', { name: /export to self-custody/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /set .* as primary/i })).toBeNull();
  });
});

describe('WalletRow set-primary button', () => {
  it('carries an aria-label with the truncated address and calls onSetPrimary on click', async () => {
    const user = userEvent.setup();
    const { onSetPrimary } = renderRow(fakeAddedByowWallet);
    const truncated = truncateAddress(fakeAddedByowWallet.address);
    const button = screen.getByRole('button', {
      name: new RegExp(`set wallet ${truncated} as primary`, 'i'),
    });
    expect(button).toBeInTheDocument();
    await user.click(button);
    expect(onSetPrimary).toHaveBeenCalledWith(fakeAddedByowWallet);
  });

  it('disables the trailing button when isPending is true', () => {
    renderRow(fakeAddedByowWallet, true);
    expect(screen.getByRole('button', { name: /set .* as primary/i })).toBeDisabled();
  });
});
