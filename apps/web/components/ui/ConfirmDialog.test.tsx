import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

// jsdom does not implement the native <dialog> modal API. Polyfill the two methods the component drives
// imperatively so showModal()/close() flip `.open` the way the platform would.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});

function renderDialog(overrides: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const props: React.ComponentProps<typeof ConfirmDialog> = {
    open: true,
    title: 'Confirm action',
    confirmLabel: 'Confirm',
    variant: 'primary',
    busy: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    children: <span>Are you sure?</span>,
    ...overrides,
  };
  return { props, ...render(<ConfirmDialog {...props} />) };
}

describe('ConfirmDialog', () => {
  it('opens the dialog imperatively when open (showModal called)', () => {
    renderDialog({ open: true });
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });

  it('uses role=alertdialog for the destructive variant', () => {
    renderDialog({ variant: 'destructive' });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('uses role=dialog for the primary variant', () => {
    renderDialog({ variant: 'primary' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('disables confirm and cancel while busy', () => {
    renderDialog({ busy: true, confirmLabel: 'Save' });
    expect(screen.getByRole('button', { name: '…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
  });

  it('does not call onCancel on Escape while busy', () => {
    const onCancel = vi.fn();
    renderDialog({ busy: true, onCancel });
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel on Escape while idle', () => {
    const onCancel = vi.fn();
    renderDialog({ busy: false, onCancel });
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders error text with role alert', () => {
    renderDialog({ error: 'Something failed.' });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something failed.');
  });

  it('calls onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    renderDialog({ onConfirm, confirmLabel: 'Delete' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the element that opened it when it closes', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const base: React.ComponentProps<typeof ConfirmDialog> = {
      open: true,
      title: 'Confirm action',
      confirmLabel: 'Confirm',
      variant: 'primary',
      busy: false,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
      children: <span>Are you sure?</span>,
    };
    const { rerender } = render(<ConfirmDialog {...base} />);
    // Opening moves focus onto the confirm control (away from the trigger).
    expect(document.activeElement).not.toBe(trigger);

    rerender(<ConfirmDialog {...base} open={false} />);
    // Closing must return focus to the trigger, not drop it to <body>.
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
