import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QuoteForm, { validateQuoteForm } from '@/components/quote/QuoteForm';

describe('validateQuoteForm (pure)', () => {
  it('produces the canonical base (integer stroop price) when both fields are valid', () => {
    const { base, countError, priceError } = validateQuoteForm('25', '15');
    expect(countError).toBeNull();
    expect(priceError).toBeNull();
    expect(base).toEqual({ fractionCount: 25, pricePerFractionStroops: '150000000' });
  });

  it('rejects a non-integer / < 1 / non-numeric count', () => {
    expect(validateQuoteForm('0', '15').base).toBeNull();
    expect(validateQuoteForm('1.5', '15').base).toBeNull();
    expect(validateQuoteForm('abc', '15').countError).toMatch(/whole number/i);
  });

  it('rejects price <= 0, > u96, and > 7 decimal places without float drift', () => {
    expect(validateQuoteForm('1', '0').priceError).toMatch(/above 0/i);
    expect(validateQuoteForm('1', '0.12345678').priceError).toMatch(/7 decimal/i);
    // 2^96 in USDC is > u96 in stroops
    expect(validateQuoteForm('1', '7922816251426433759354395034').priceError).toBeTruthy();
  });

  it('flags price × count > i128 as a joint overflow on the price field', () => {
    const { base, priceError } = validateQuoteForm(
      '9000000000000000',
      '7922816251426433759354395033.5',
    );
    expect(base).toBeNull();
    expect(priceError).toMatch(/too large/i);
  });
});

describe('QuoteForm (interaction)', () => {
  it('renders text-mode money inputs (never type=number) and a validity preset select defaulting to 48h', () => {
    render(<QuoteForm disabled={false} onSubmit={vi.fn()} />);
    const count = screen.getByLabelText(/fractions to sell/i);
    const price = screen.getByLabelText(/price per fraction/i);
    expect(count).toHaveAttribute('type', 'text');
    expect(price).toHaveAttribute('type', 'text');
    expect(count).toHaveAttribute('inputmode', 'numeric');
    expect(price).toHaveAttribute('inputmode', 'decimal');
    expect((screen.getByLabelText(/quote valid for/i) as HTMLSelectElement).value).toBe('48');
  });

  it('updates the "you’d receive" preview to 375.00 for count=25, price=15', () => {
    render(<QuoteForm disabled={false} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/fractions to sell/i), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText(/price per fraction/i), { target: { value: '15' } });
    expect(screen.getByText('375.00')).toBeInTheDocument();
  });

  it('disables submit until valid, then emits a QuoteInput with a resolved Z instant validUntil', () => {
    const onSubmit = vi.fn();
    render(<QuoteForm disabled={false} onSubmit={onSubmit} />);
    const button = screen.getByRole('button', { name: /submit quote/i });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/fractions to sell/i), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText(/price per fraction/i), { target: { value: '15' } });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const arg = onSubmit.mock.calls[0][0];
    expect(arg.fractionCount).toBe(25);
    expect(arg.pricePerFractionStroops).toBe('150000000');
    expect(arg.validUntil).toMatch(/Z$/); // explicit tz offset
    expect(new Date(arg.validUntil).getTime()).toBeGreaterThan(Date.now());
  });

  it('does not emit when disabled (submitting)', () => {
    const onSubmit = vi.fn();
    render(<QuoteForm disabled onSubmit={onSubmit} />);
    fireEvent.submit(screen.getByRole('button', { name: /submitting/i }).closest('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
