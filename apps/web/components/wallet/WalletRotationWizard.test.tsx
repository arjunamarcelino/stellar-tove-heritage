import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { WalletRotationState, WalletSummary } from '@/lib/types/api';

const h = vi.hoisted(() => ({
  state: { status: 'selectingDestination' } as WalletRotationState,
  chooseDestination: vi.fn(),
  confirmAndTransfer: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('@/hooks/useWalletRotation', () => ({
  useWalletRotation: () => ({
    state: h.state,
    chooseDestination: h.chooseDestination,
    confirmAndTransfer: h.confirmAndTransfer,
    resume: h.resume,
    cancel: h.cancel,
    reset: h.reset,
  }),
}));

import WalletRotationWizard from '@/components/wallet/WalletRotationWizard';

const SOURCE = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const DEST_ADDR = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const WALLETS: WalletSummary[] = [
  { id: SOURCE, kind: 'embedded_passkey', address: 'CSRC', exported: false, isPrimary: true },
  {
    id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
    kind: 'byow',
    address: DEST_ADDR,
    exported: false,
    isPrimary: false,
  },
];

function renderWizard() {
  return render(
    <WalletRotationWizard sourceWalletId={SOURCE} wallets={WALLETS} initialStatus={null} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state = { status: 'selectingDestination', wallets: WALLETS } as WalletRotationState;
});

describe('WalletRotationWizard', () => {
  it('lists eligible destinations and walks pick → make-primary → chooseDestination', () => {
    renderWizard();
    fireEvent.click(screen.getByText(/GA7QYN/));
    // Consent sub-step
    expect(screen.getByText(/primary settlement wallet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Make primary/i }));
    expect(h.chooseDestination).toHaveBeenCalledWith({
      id: WALLETS[1]!.id,
      address: DEST_ADDR,
    });
  });

  it('names the lockup expiry and renders Confirm as aria-disabled (not native disabled)', () => {
    h.state = {
      status: 'reviewing',
      destination: { id: WALLETS[1]!.id, address: DEST_ADDR },
      items: [],
      blocked: { code: 'ROTATION_BLOCKED_BY_LOCKUP', lockupExpiresAt: '2026-11-04T00:00:00.000Z' },
    };
    renderWizard();
    expect(screen.getByText(/2026/)).toBeInTheDocument(); // the unlock date is named
    const confirm = screen.getByRole('button', { name: /Confirm & move/i });
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    expect(confirm).toHaveAttribute('aria-describedby');
    expect(confirm).not.toBeDisabled(); // focusable — reason discoverable by AT
    fireEvent.click(confirm);
    expect(h.confirmAndTransfer).not.toHaveBeenCalled();
  });

  it('shows the fraction list, no-fee + USDC copy, and confirms the move', () => {
    h.state = {
      status: 'reviewing',
      destination: { id: WALLETS[1]!.id, address: DEST_ADDR },
      items: [
        {
          itemId: 'i1',
          tokenContract: 'CA1',
          amountScaled: '500',
          decimals: 0,
          displayName: 'Fraction A',
          challenge: 'c',
          expiresAtLedger: 1,
          credentialId: 'x',
          rpId: 'tove.io',
          transports: 'internal',
        },
      ],
    };
    renderWizard();
    expect(screen.getByText('Fraction A')).toBeInTheDocument();
    expect(screen.getByText('×500')).toBeInTheDocument();
    expect(screen.getByText(/No network fee/i)).toBeInTheDocument();
    expect(screen.getByText(/USDC stays on your current wallet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirm & move/i }));
    expect(h.confirmAndTransfer).toHaveBeenCalled();
  });

  it('renders a determinate progressbar while transferring', () => {
    h.state = {
      status: 'transferring',
      phase: 'polling',
      confirmedCount: 3,
      total: 7,
      destination: { id: WALLETS[1]!.id, address: DEST_ADDR },
    };
    renderWizard();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(bar).toHaveAttribute('aria-valuemax', '7');
    expect(screen.getByText(/Transferred 3 of 7/)).toBeInTheDocument();
  });

  it('completes with the moved count and a link back to settings', () => {
    h.state = {
      status: 'complete',
      destination: { id: WALLETS[1]!.id, address: DEST_ADDR },
      movedCount: 2,
    };
    renderWizard();
    // Present in both the visible card and the sr-only live region — assert at least one.
    expect(screen.getAllByText(/2 fractions moved/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Done — back to settings/i })).toHaveAttribute(
      'href',
      '/settings?rotated=1',
    );
  });
});
