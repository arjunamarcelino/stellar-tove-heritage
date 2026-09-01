import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ApprovalQuorumPanel } from './approval-quorum-panel';
import type { ApprovalPanelState } from '../hooks/use-offering-approval-lifecycle';

const C_ADDR = 'C' + 'A'.repeat(55);

function renderPanel(state: ApprovalPanelState, overrides: Partial<{ isPending: boolean }> = {}) {
  const onApprove = vi.fn();
  const onCheckAgain = vi.fn();
  render(
    <ApprovalQuorumPanel
      state={state}
      count={1}
      threshold={2}
      isPending={overrides.isPending ?? false}
      onApprove={onApprove}
      onCheckAgain={onCheckAgain}
    />,
  );
  return { onApprove, onCheckAgain };
}

describe('ApprovalQuorumPanel', () => {
  it('shows "1 of 2 approvals" progress text', () => {
    renderPanel({ kind: 'can-approve' });
    expect(screen.getByText(/1 of 2/)).toBeInTheDocument();
  });

  it('can-approve: Approve button fires onApprove', () => {
    const { onApprove } = renderPanel({ kind: 'can-approve' });
    fireEvent.click(screen.getByRole('button', { name: 'Approve offering' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('disables the CTA while pending', () => {
    renderPanel({ kind: 'can-approve' }, { isPending: true });
    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
  });

  it('deploying: role=status + Check again resumes the poll', () => {
    const { onCheckAgain } = renderPanel({ kind: 'deploying' });
    expect(screen.getByRole('status')).toHaveTextContent(/Deploying escrow/i);
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
  });

  it('deployed: renders the escrow address + stellar.expert link', () => {
    renderPanel({ kind: 'deployed', contractAddress: C_ADDR });
    expect(screen.getByText(C_ADDR)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /stellar\.expert/i });
    expect(link).toHaveAttribute('href', expect.stringContaining(`/contract/${C_ADDR}`));
  });

  it('deploy-failed: Retry fires onApprove', () => {
    const { onApprove } = renderPanel({ kind: 'deploy-failed' });
    fireEvent.click(screen.getByRole('button', { name: 'Retry approval' }));
    expect(onApprove).toHaveBeenCalled();
  });

  it('already-approved: calm status message, no Approve button', () => {
    renderPanel({ kind: 'already-approved' });
    expect(screen.getByRole('status')).toHaveTextContent(/you have approved/i);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('not-a-signer: calm status message, no Approve button', () => {
    renderPanel({ kind: 'not-a-signer' });
    expect(screen.getByRole('status')).toHaveTextContent(/not an approver/i);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('read-only: shows the status, no action', () => {
    renderPanel({ kind: 'read-only', status: 'opened' });
    expect(screen.getByText(/no approval action available/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
