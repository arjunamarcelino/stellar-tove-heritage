import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DocumentUpload from '@/components/kyc/DocumentUpload';

function setup(overrides: Partial<React.ComponentProps<typeof DocumentUpload>> = {}) {
  const onSelect = vi.fn();
  const onRemove = vi.fn();
  render(
    <DocumentUpload
      docType="gov_id_front"
      label="Government ID (front)"
      hint="JPEG, PNG or PDF · max 10 MB"
      accept="image/jpeg,image/png,application/pdf"
      onSelect={onSelect}
      onRemove={onRemove}
      {...overrides}
    />,
  );
  return { onSelect, onRemove };
}

describe('DocumentUpload', () => {
  it('renders a labelled, keyboard-reachable file input with the accept types', () => {
    setup();
    const input = screen.getByLabelText(/government id \(front\)/i);
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,application/pdf');
  });

  it('forwards a selected file to onSelect', () => {
    const { onSelect } = setup();
    const input = screen.getByLabelText(/government id/i);
    const file = new File(['x'], 'id.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onSelect).toHaveBeenCalledWith('gov_id_front', file);
  });

  it('accepts a file via drag-and-drop', () => {
    const { onSelect } = setup();
    const file = new File(['x'], 'id.png', { type: 'image/png' });
    const label = screen.getByText(/drag & drop/i).closest('label');
    expect(label).not.toBeNull();
    fireEvent.drop(label as HTMLElement, { dataTransfer: { files: [file] } });
    expect(onSelect).toHaveBeenCalledWith('gov_id_front', file);
  });

  it('shows the filename and a remove control when a file is present', () => {
    const { onRemove } = setup({
      file: new File(['x'], 'passport.pdf', { type: 'application/pdf' }),
    });
    expect(screen.getByText('passport.pdf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledWith('gov_id_front');
  });

  it('renders a slot error with role=alert and marks the input invalid', () => {
    setup({ error: 'This file is larger than the 10 MB limit.' });
    expect(screen.getByRole('alert')).toHaveTextContent('10 MB limit');
    expect(screen.getByLabelText(/government id/i)).toHaveAttribute('aria-invalid', 'true');
  });
});
