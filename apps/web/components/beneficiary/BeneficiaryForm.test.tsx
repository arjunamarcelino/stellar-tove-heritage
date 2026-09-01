import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BeneficiaryForm from '@/components/beneficiary/BeneficiaryForm';
import type { BeneficiaryFormValues } from '@/lib/beneficiary/schemas';

const VALID: BeneficiaryFormValues = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  stellarPubkey: '',
  relationship: 'spouse',
  notes: '',
};

function renderForm(overrides: Partial<React.ComponentProps<typeof BeneficiaryForm>> = {}) {
  const props: React.ComponentProps<typeof BeneficiaryForm> = {
    values: VALID,
    setValue: vi.fn(),
    errorMessage: null,
    canSave: true,
    saving: false,
    dirty: true,
    submitLabel: 'Save',
    onSubmit: vi.fn(),
    onDiscard: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<BeneficiaryForm {...props} />) };
}

describe('BeneficiaryForm', () => {
  it('shows an inline email error and disables submit when the email is invalid', () => {
    renderForm({ values: { ...VALID, email: 'not-an-email' }, canSave: false });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Enter a valid email address');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('enables submit and calls onSubmit when values are valid and canSave', () => {
    const onSubmit = vi.fn();
    renderForm({ onSubmit, canSave: true });
    const submit = screen.getByRole('button', { name: 'Save' });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows an inline error for an invalid Stellar public key', () => {
    renderForm({ values: { ...VALID, stellarPubkey: 'GXXXX' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid Stellar public key');
  });

  it('calls setValue with the field key when typing in the name field', () => {
    const setValue = vi.fn();
    renderForm({ setValue });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'John Roe' } });
    expect(setValue).toHaveBeenCalledWith('name', 'John Roe');
  });

  it('disables the Discard button when the form is not dirty', () => {
    renderForm({ dirty: false });
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
  });

  it('renders the notes character counter', () => {
    renderForm();
    expect(screen.getByText(/\/ 1000/)).toBeInTheDocument();
  });

  it('shows a required error for an empty email only after it is blurred', () => {
    renderForm({ values: { ...VALID, email: '' }, canSave: false });
    expect(screen.queryByText('Email is required')).toBeNull();
    fireEvent.blur(screen.getByLabelText('Email'));
    expect(screen.getByText('Email is required')).toBeInTheDocument();
  });
});
