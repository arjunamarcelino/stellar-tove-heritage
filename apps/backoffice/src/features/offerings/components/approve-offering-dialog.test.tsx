import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ApproveOfferingDialog } from './approve-offering-dialog';
import type { OfferingDetail } from '../schemas';

function offering(): OfferingDetail {
  return {
    id: 'o1',
    artworkId: 'a1',
    status: 'planned',
    lowPriceStroops: '1000000',
    highPriceStroops: '5000000',
    publicFloat: '800000',
    windowOpenAt: '2026-09-01T00:00:00.000Z',
    windowCloseAt: '2026-09-08T00:00:00.000Z',
    attestedArtistAddress: 'G' + 'A'.repeat(55),
    escrow: { deployStatus: null, contractAddress: null, deployLedger: null, approvedAt: null },
    approvals: { count: 1, threshold: 2, youApproved: false },
  } as unknown as OfferingDetail;
}

describe('ApproveOfferingDialog', () => {
  it('echoes the payload for verify-before-sign', () => {
    render(
      <ApproveOfferingDialog
        open
        onOpenChange={vi.fn()}
        offering={offering()}
        isPending={false}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText('Price band')).toBeInTheDocument();
    expect(screen.getByText('800,000')).toBeInTheDocument(); // public float grouped
    expect(screen.getByText(/2 required/)).toBeInTheDocument();
    // attested payout recipient surfaced at sign-time (verify-before-sign)
    expect(screen.getByText('Attested payout')).toBeInTheDocument();
    expect(screen.getByText('G' + 'A'.repeat(55))).toBeInTheDocument();
  });

  it('Approve fires onConfirm', () => {
    const onConfirm = vi.fn();
    render(
      <ApproveOfferingDialog
        open
        onOpenChange={vi.fn()}
        offering={offering()}
        isPending={false}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('is non-dismissable while pending: Cancel + Approve disabled', () => {
    const onOpenChange = vi.fn();
    render(
      <ApproveOfferingDialog
        open
        onOpenChange={onOpenChange}
        offering={offering()}
        isPending
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
  });
});
