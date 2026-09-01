import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Beneficiary } from '@/lib/types/api';

// Mock the server actions (the hook calls these) + the router.
const h = vi.hoisted(() => ({
  setBeneficiaryAction: vi.fn(),
  removeBeneficiaryAction: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('@/app/actions/beneficiary', () => ({
  setBeneficiaryAction: h.setBeneficiaryAction,
  removeBeneficiaryAction: h.removeBeneficiaryAction,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace }) }));

import BeneficiarySettings from '@/components/beneficiary/BeneficiarySettings';

const ROW: Beneficiary = {
  id: 'b1',
  name: 'Jane Doe',
  email: 'jane@example.com',
  stellarPubkey: null,
  relationship: 'spouse',
  notes: null,
  createdAt: '2026-08-26T12:00:00.000Z',
  updatedAt: '2026-08-26T12:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom doesn't implement showModal/close — polyfill them so the native <dialog> can "open".
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

describe('BeneficiarySettings (integration)', () => {
  it('AC — sets a beneficiary from empty: fill → confirm → toast → summary', async () => {
    h.setBeneficiaryAction.mockResolvedValue({
      status: 'success',
      beneficiary: {
        ...ROW,
        id: 'b2',
        name: 'John Roe',
        email: 'john@roe.com',
        relationship: null,
      },
      notice: null,
    });
    render(<BeneficiarySettings beneficiary={null} notice={null} />);

    fireEvent.click(screen.getByRole('button', { name: /add a beneficiary/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'John Roe' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'john@roe.com' } });

    const submit = screen.getByRole('button', { name: /save beneficiary/i });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    // Confirm modal → its confirm button (scoped to the dialog, label 'Save').
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(h.setBeneficiaryAction).toHaveBeenCalledTimes(1));
    await screen.findByText('Beneficiary saved');
    await screen.findByText('John Roe'); // summary now shows the echoed row
  });

  it('AC — invalid email disables submit and shows an inline error', () => {
    render(<BeneficiarySettings beneficiary={null} notice={null} />);
    fireEvent.click(screen.getByRole('button', { name: /add a beneficiary/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } });

    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save beneficiary/i })).toBeDisabled();
  });

  it('AC — update shows an old→new email diff, then saves', async () => {
    h.setBeneficiaryAction.mockResolvedValue({
      status: 'success',
      beneficiary: { ...ROW, email: 'jane.new@example.com' },
      notice: null,
    });
    render(<BeneficiarySettings beneficiary={ROW} notice={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane.new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    const dialog = screen.getByRole('dialog');
    // The diff surfaces both the old and the new value.
    expect(within(dialog).getByText('jane@example.com')).toBeInTheDocument();
    expect(within(dialog).getByText('jane.new@example.com')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(h.setBeneficiaryAction).toHaveBeenCalledTimes(1));
    await screen.findByText('Beneficiary saved');
  });

  it('AC — remove: destructive confirm → DELETE → empty state + toast', async () => {
    h.removeBeneficiaryAction.mockResolvedValue({
      status: 'success',
      beneficiary: null,
      notice: null,
    });
    render(<BeneficiarySettings beneficiary={ROW} notice={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Remove$/ }));

    await waitFor(() => expect(h.removeBeneficiaryAction).toHaveBeenCalledTimes(1));
    await screen.findByText('Beneficiary removed');
    await screen.findByRole('button', { name: /add a beneficiary/i });
  });

  it('redirects to /login when a write returns SESSION_EXPIRED', async () => {
    h.setBeneficiaryAction.mockResolvedValue({
      status: 'error',
      code: 'SESSION_EXPIRED',
      message: 'x',
    });
    render(<BeneficiarySettings beneficiary={null} notice={null} />);
    fireEvent.click(screen.getByRole('button', { name: /add a beneficiary/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /save beneficiary/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/login'));
  });

  it('shows the KYC banner only when a notice is present', () => {
    const { unmount } = render(
      <BeneficiarySettings beneficiary={null} notice={{ code: 'KYC_REQUIRED_FOR_TRANSFER' }} />,
    );
    expect(screen.getByText(/complete kyc/i)).toBeInTheDocument();
    unmount();

    render(<BeneficiarySettings beneficiary={null} notice={null} />);
    expect(screen.queryByText(/complete kyc/i)).toBeNull();
  });

  it('refreshes the KYC banner from the write echo notice', async () => {
    // Start whitelisted (no banner), then a save whose echo carries a notice must reveal the banner.
    h.setBeneficiaryAction.mockResolvedValue({
      status: 'success',
      beneficiary: { ...ROW, id: 'b2', name: 'John Roe', email: 'john@roe.com' },
      notice: { code: 'KYC_REQUIRED_FOR_TRANSFER' },
    });
    render(<BeneficiarySettings beneficiary={null} notice={null} />);
    expect(screen.queryByText(/complete kyc/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /add a beneficiary/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'John Roe' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'john@roe.com' } });
    fireEvent.click(screen.getByRole('button', { name: /save beneficiary/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Save$/ }));

    await screen.findByText(/complete kyc/i);
  });

  it('renders untrusted name as inert text (no HTML injection)', () => {
    const { container } = render(
      <BeneficiarySettings
        beneficiary={{ ...ROW, name: '<script>alert(1)</script>' }}
        notice={null}
      />,
    );
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
  });
});
