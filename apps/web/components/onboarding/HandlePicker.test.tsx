import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HandlePickerState } from '@/lib/types/api';

const h = vi.hoisted(() => ({
  value: '',
  state: { status: 'idle' } as HandlePickerState,
  onChange: vi.fn(),
  onCompositionStart: vi.fn(),
  onCompositionEnd: vi.fn(),
  submit: vi.fn(),
}));

vi.mock('@/hooks/useHandlePicker', () => ({
  useHandlePicker: () => ({
    value: h.value,
    state: h.state,
    onChange: h.onChange,
    onCompositionStart: h.onCompositionStart,
    onCompositionEnd: h.onCompositionEnd,
    submit: h.submit,
  }),
}));

import HandlePicker from '@/components/onboarding/HandlePicker';

beforeEach(() => {
  vi.clearAllMocks();
  h.value = '';
  h.state = { status: 'idle' };
});

function cta() {
  return screen.getByRole('button', { name: /continue|saving/i });
}

describe('HandlePicker', () => {
  it('renders the helper line and a disabled CTA when idle', () => {
    render(<HandlePicker />);
    expect(screen.getByText(/public and can’t be changed yet/i)).toBeInTheDocument();
    expect(cta()).toBeDisabled();
  });

  it('shows the schema message and marks the field invalid', () => {
    h.state = { status: 'invalid', message: 'Handle must be at least 3 characters' };
    render(<HandlePicker />);
    expect(screen.getByRole('status')).toHaveTextContent(/at least 3 characters/i);
    expect(screen.getByLabelText(/choose your handle/i)).toHaveAttribute('aria-invalid', 'true');
    expect(cta()).toBeDisabled();
  });

  it('announces checking with aria-busy and keeps the CTA disabled', () => {
    h.state = { status: 'checking' };
    render(<HandlePicker />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/checking availability/i);
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(cta()).toBeDisabled();
  });

  it('enables the CTA only when available', () => {
    h.state = { status: 'available' };
    render(<HandlePicker />);
    expect(screen.getByRole('status')).toHaveTextContent(/available/i);
    expect(cta()).toBeEnabled();
    expect(screen.getByLabelText(/choose your handle/i)).toHaveAttribute('aria-invalid', 'false');
  });

  it('shows a distinct taken message with the field invalid and CTA disabled', () => {
    h.state = { status: 'unavailable', reason: 'taken', message: 'That handle is taken.' };
    render(<HandlePicker />);
    expect(screen.getByRole('status')).toHaveTextContent(/taken/i);
    expect(screen.getByLabelText(/choose your handle/i)).toHaveAttribute('aria-invalid', 'true');
    expect(cta()).toBeDisabled();
  });

  it('renders a submit error message', () => {
    h.state = {
      status: 'error',
      code: 'SERVER_ERROR',
      message: 'Something went wrong.',
    };
    render(<HandlePicker />);
    expect(screen.getByRole('status')).toHaveTextContent(/something went wrong/i);
  });

  it('shows a Saving… label and disables the input while submitting', () => {
    h.state = { status: 'submitting' };
    render(<HandlePicker />);
    expect(cta()).toHaveTextContent(/saving/i);
    expect(cta()).toBeDisabled();
    expect(screen.getByLabelText(/choose your handle/i)).toBeDisabled();
  });

  it('preserves casing in the field and forwards keystrokes to the hook', async () => {
    h.value = 'Maya';
    render(<HandlePicker />);
    expect(screen.getByLabelText(/choose your handle/i)).toHaveValue('Maya');
  });

  it('submits when the CTA is clicked in the available state', async () => {
    h.state = { status: 'available' };
    render(<HandlePicker />);
    await userEvent.click(cta());
    expect(h.submit).toHaveBeenCalledTimes(1);
  });
});
