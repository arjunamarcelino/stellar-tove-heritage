'use client';

import { useMemo, useState } from 'react';
import { usdcToStroops, escrowAmount, formatUsdc } from '@/lib/money/format';
import { U96_MAX, I128_MAX } from '@/lib/money/constants';
import { EXPIRY_PRESETS, DEFAULT_EXPIRY_HOURS } from '@/lib/rfq/constants';
import { PRIMARY_BUTTON } from '@/components/ui/buttons';
import { MONEY_FIGURE } from '@/components/ui/typography';
import type { RfqInput } from '@/lib/types/api';

// The RFQ create form (TOV-173 / FR-06.01). Money inputs are type="text" (inputmode decimal/numeric) — NEVER
// type="number", which would coerce to float and destroy i128/2^96 precision. Two INDEPENDENT numeric bounds
// (per-fraction price ≤ u96, price × count ≤ i128) are validated client-side. The live max-exposure preview is
// FAIL-CLOSED: escrowAmount/formatUsdc throw on malformed input, so we compute only after both fields validate.
// Amounts are a CEILING of intent — never "you pay"/"escrow" (no funds move). aria-invalid is set only after a
// field is engaged.

const EXPIRY_LABELS: Record<(typeof EXPIRY_PRESETS)[number], string> = {
  24: '24 hours',
  48: '48 hours (default)',
  72: '72 hours',
  168: '7 days (168h)',
};

interface Validated {
  input: RfqInput | null; // non-null only when fully valid
  countError: string | null;
  priceError: string | null;
}

// Pure validation over the raw field strings. Returns per-field errors and, when everything is valid, the
// canonical RfqInput (integer stroop price, integer count, preset expiry).
export function validateRfqForm(
  countStr: string,
  priceStr: string,
  expiryHours: (typeof EXPIRY_PRESETS)[number],
): Validated {
  const countOk = /^[1-9]\d*$/.test(countStr) && Number.isSafeInteger(Number(countStr));
  const countError =
    countStr === '' || countOk ? null : 'Enter a whole number of fractions (1 or more).';

  const parsed = usdcToStroops(priceStr);
  let priceError: string | null = null;
  let priceStroops: string | null = null;
  if (priceStr === '') {
    priceError = null;
  } else if (!parsed.ok) {
    priceError =
      parsed.reason === 'too-precise' ? 'Use up to 7 decimal places.' : 'Enter a valid amount.';
  } else if (BigInt(parsed.stroops) <= BigInt(0)) {
    priceError = 'Enter a price above 0.';
  } else if (BigInt(parsed.stroops) > U96_MAX) {
    priceError = 'That price is too large.';
  } else {
    priceStroops = parsed.stroops;
  }

  // Overflow is a joint constraint — surface it on the price field once both sides are otherwise valid.
  if (countOk && priceStroops && BigInt(priceStroops) * BigInt(Number(countStr)) > I128_MAX) {
    priceError = 'That price × quantity is too large. Lower the price or quantity.';
    priceStroops = null;
  }

  const input =
    countOk && priceStroops
      ? { fractionCount: Number(countStr), maxPricePerFractionStroops: priceStroops, expiryHours }
      : null;

  return { input, countError, priceError };
}

export default function RfqForm({
  disabled,
  onSubmit,
  autoFocus,
}: {
  disabled: boolean;
  onSubmit: (input: RfqInput) => void;
  autoFocus?: boolean;
}) {
  const [count, setCount] = useState('');
  const [price, setPrice] = useState('');
  const [expiry, setExpiry] = useState<(typeof EXPIRY_PRESETS)[number]>(DEFAULT_EXPIRY_HOURS);
  const [touched, setTouched] = useState<{ count: boolean; price: boolean }>({
    count: false,
    price: false,
  });

  const { input, countError, priceError } = useMemo(
    () => validateRfqForm(count, price, expiry),
    [count, price, expiry],
  );

  // Fail-closed preview: only valid input yields a figure (escrowAmount/formatUsdc throw on bad input).
  const preview = useMemo(
    () =>
      input
        ? formatUsdc(escrowAmount(input.maxPricePerFractionStroops, input.fractionCount))
        : null,
    [input],
  );

  const showCountError = touched.count && countError;
  const showPriceError = touched.price && priceError;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (input && !disabled) onSubmit(input);
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="rfq-count" className="text-sm font-medium text-charcoal">
          Number of fractions
        </label>
        <input
          id="rfq-count"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          autoFocus={autoFocus}
          value={count}
          disabled={disabled}
          onChange={(e) => setCount(e.target.value.trim())}
          onBlur={() => setTouched((t) => ({ ...t, count: true }))}
          aria-invalid={showCountError ? true : undefined}
          aria-describedby={showCountError ? 'rfq-count-error' : undefined}
          className="rounded-sm border border-charcoal/20 px-3 py-2 text-sm text-umber focus:border-charcoal focus:outline-none disabled:opacity-50"
        />
        {showCountError ? (
          <p id="rfq-count-error" className="text-xs text-sienna">
            {countError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="rfq-price" className="text-sm font-medium text-charcoal">
          Max price per fraction
        </label>
        <div className="flex items-center gap-2">
          <input
            id="rfq-price"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={price}
            disabled={disabled}
            onChange={(e) => setPrice(e.target.value.trim())}
            onBlur={() => setTouched((t) => ({ ...t, price: true }))}
            aria-invalid={showPriceError ? true : undefined}
            aria-describedby={showPriceError ? 'rfq-price-error' : undefined}
            className="w-full rounded-sm border border-charcoal/20 px-3 py-2 text-sm text-umber focus:border-charcoal focus:outline-none disabled:opacity-50"
          />
          <span className="text-sm font-medium text-charcoal/70">USDC</span>
        </div>
        {showPriceError ? (
          <p id="rfq-price-error" className="text-xs text-sienna">
            {priceError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="rfq-expiry" className="text-sm font-medium text-charcoal">
          Offer valid for
        </label>
        <select
          id="rfq-expiry"
          value={expiry}
          disabled={disabled}
          onChange={(e) => setExpiry(Number(e.target.value) as (typeof EXPIRY_PRESETS)[number])}
          className="rounded-sm border border-charcoal/20 px-3 py-2 text-sm text-umber focus:border-charcoal focus:outline-none disabled:opacity-50"
        >
          {EXPIRY_PRESETS.map((h) => (
            <option key={h} value={h}>
              {EXPIRY_LABELS[h]}
            </option>
          ))}
        </select>
      </div>

      <p className="text-sm text-charcoal/70">
        Up to <span className={MONEY_FIGURE}>{preview ?? '—'}</span> USDC total if the offer fills.
      </p>

      <button
        type="submit"
        disabled={disabled || !input}
        aria-busy={disabled || undefined}
        className={`${PRIMARY_BUTTON} self-start`}
      >
        {disabled ? 'Sending…' : 'Make offer'}
      </button>
    </form>
  );
}
