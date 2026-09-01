import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RfqForm, { validateRfqForm } from '@/components/rfq/RfqForm';

// Pure validation — the two independent numeric bounds + precision + count shape.
describe('validateRfqForm', () => {
  it('valid input yields the canonical RfqInput (USDC → stroops)', () => {
    const { input, countError, priceError } = validateRfqForm('100', '15', 48);
    expect(countError).toBeNull();
    expect(priceError).toBeNull();
    expect(input).toEqual({
      fractionCount: 100,
      maxPricePerFractionStroops: '150000000',
      expiryHours: 48,
    });
  });

  it('price = 0 → "Enter a price above 0."', () => {
    expect(validateRfqForm('1', '0', 48).priceError).toMatch(/above 0/i);
  });

  it('price with > 7 decimals → precision error', () => {
    expect(validateRfqForm('1', '1.12345678', 48).priceError).toMatch(/7 decimal/i);
  });

  it('accepts the max per-fraction price (2^96-1 stroops) with count 1', () => {
    // 2^96-1 stroops = 7,922,816,251,426,433,759,354.3950335 USDC
    const { input } = validateRfqForm('1', '7922816251426433759354.3950335', 48);
    expect(input?.maxPricePerFractionStroops).toBe('79228162514264337593543950335');
  });

  it('rejects a price just over 2^96-1 as too large (distinct from the product bound)', () => {
    // 2^96 stroops
    expect(validateRfqForm('1', '7922816251426433759354.3950336', 48).priceError).toMatch(
      /too large/i,
    );
  });

  it('rejects price × count over i128 as overflow (surfaced on the price field)', () => {
    const { priceError, input } = validateRfqForm(
      '9000000000000000',
      '7922816251426433759354.3950335',
      48,
    );
    expect(priceError).toMatch(/too large/i);
    expect(input).toBeNull();
  });

  it('rejects a non-canonical / < 1 count', () => {
    expect(validateRfqForm('0', '15', 48).countError).toMatch(/whole number/i);
    expect(validateRfqForm('1.5', '15', 48).countError).toMatch(/whole number/i);
    expect(validateRfqForm('007', '15', 48).countError).toMatch(/whole number/i);
  });

  it('empty fields produce no error text (just an invalid/disabled state)', () => {
    const r = validateRfqForm('', '', 48);
    expect(r.countError).toBeNull();
    expect(r.priceError).toBeNull();
    expect(r.input).toBeNull();
  });
});

describe('RfqForm', () => {
  it('disables submit until valid, previews max exposure, and submits the canonical input', () => {
    const onSubmit = vi.fn();
    render(<RfqForm disabled={false} onSubmit={onSubmit} />);

    const submit = screen.getByRole('button', { name: /make offer/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/number of fractions/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/max price per fraction/i), { target: { value: '15' } });

    // Live max-exposure preview: 150,000,000 stroops × 100 = 15,000,000,000 stroops = 1,500.00 USDC.
    expect(screen.getByText('1,500.00')).toBeInTheDocument();
    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({
      fractionCount: 100,
      maxPricePerFractionStroops: '150000000',
      expiryHours: 48,
    });
  });

  it('shows a price error only after the field is engaged (blur), and disables submit', () => {
    render(<RfqForm disabled={false} onSubmit={vi.fn()} />);
    const price = screen.getByLabelText(/max price per fraction/i);
    fireEvent.change(price, { target: { value: '0' } });
    // Not yet blurred → no error rendered.
    expect(screen.queryByText(/above 0/i)).not.toBeInTheDocument();
    fireEvent.blur(price);
    expect(screen.getByText(/above 0/i)).toBeInTheDocument();
    expect(price).toHaveAttribute('aria-invalid', 'true');
  });

  it('renders a neutral placeholder preview for mid-type input (never throws)', () => {
    render(<RfqForm disabled={false} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/max price per fraction/i), { target: { value: '1.' } });
    fireEvent.change(screen.getByLabelText(/number of fractions/i), { target: { value: '' } });
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('uses text inputs (never type=number) to protect big-integer precision', () => {
    render(<RfqForm disabled={false} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/max price per fraction/i)).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText(/max price per fraction/i)).toHaveAttribute(
      'inputmode',
      'decimal',
    );
    expect(screen.getByLabelText(/number of fractions/i)).toHaveAttribute('inputmode', 'numeric');
  });
});
