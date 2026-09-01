'use client';

import { useMemo, useState } from 'react';
import { usdcToStroops, escrowAmount, formatUsdc } from '@/lib/money/format';
import { U96_MAX, I128_MAX } from '@/lib/money/constants';
import {
  VALIDITY_PRESETS,
  DEFAULT_VALIDITY_HOURS,
  type ValidityHours,
} from '@/lib/quote/constants';
import { PRIMARY_BUTTON } from '@/components/ui/buttons';
import { MONEY_FIGURE } from '@/components/ui/typography';
import type { QuoteInput } from '@/lib/types/api';

// The quote submission form (TOV-176 / FR-06.03). Money inputs are type="text" (inputmode decimal/numeric) —
// NEVER type="number", which would coerce to float and destroy i128/2^96 precision. Two INDEPENDENT numeric
// bounds (per-fraction price <= u96, price × count <= i128) are validated client-side. The live "you'd receive"
// preview is FAIL-CLOSED: escrowAmount/formatUsdc throw on malformed input, so we compute only after both fields
// validate. validUntil is resolved from the chosen preset AT submit (a `…Z` instant) — never during render (an
// impure clock read) — and only a fully-valid form emits a QuoteInput (R4.4).

const VALIDITY_LABELS: Record<ValidityHours, string> = {
  24: '24 hours',
  48: '48 hours (default)',
  72: '72 hours',
  168: '7 days (168h)',
};

interface Validated {
  base: Pick<QuoteInput, 'fractionCount' | 'pricePerFractionStroops'> | null; // non-null only when fully valid
  countError: string | null;
  priceError: string | null;
}

// Pure validation over the raw field strings (no clock read). Returns per-field errors and, when both are valid,
// the count + integer stroop price. validUntil is resolved separately at submit (it needs the clock).
export function validateQuoteForm(countStr: string, priceStr: string): Validated {
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

  const base =
    countOk && priceStroops
      ? { fractionCount: Number(countStr), pricePerFractionStroops: priceStroops }
      : null;

  return { base, countError, priceError };
}

// Resolve a preset (hours) to an ISO-8601 `…Z` instant AT submit. `Z` is an explicit tz offset, so it satisfies
// the contract's tz requirement for free. Frozen into the request body by the hook so a same-key retry replays
// a byte-identical validUntil (C1).
function resolveValidUntil(hours: ValidityHours): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

export default function QuoteForm({
  disabled,
  onSubmit,
  autoFocus,
}: {
  disabled: boolean;
  onSubmit: (input: QuoteInput) => void;
  autoFocus?: boolean;
}) {
  const [count, setCount] = useState('');
  const [price, setPrice] = useState('');
  const [validity, setValidity] = useState<ValidityHours>(DEFAULT_VALIDITY_HOURS);
  const [touched, setTouched] = useState<{ count: boolean; price: boolean }>({
    count: false,
    price: false,
  });

  const { base, countError, priceError } = useMemo(
    () => validateQuoteForm(count, price),
    [count, price],
  );

  // Fail-closed preview: only valid input yields a figure (escrowAmount/formatUsdc throw on bad input).
  const preview = useMemo(
    () =>
      base ? formatUsdc(escrowAmount(base.pricePerFractionStroops, base.fractionCount)) : null,
    [base],
  );

  const showCountError = touched.count && countError;
  const showPriceError = touched.price && priceError;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        // Only a fully-valid form emits — validUntil resolved here (event handler), never during render.
        if (base && !disabled) onSubmit({ ...base, validUntil: resolveValidUntil(validity) });
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="quote-count" className="text-sm font-medium text-charcoal">
          Fractions to sell
        </label>
        <input
          id="quote-count"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          autoFocus={autoFocus}
          value={count}
          disabled={disabled}
          onChange={(e) => setCount(e.target.value.trim())}
          onBlur={() => setTouched((t) => ({ ...t, count: true }))}
          aria-invalid={showCountError ? true : undefined}
          aria-describedby={showCountError ? 'quote-count-error' : undefined}
          className="rounded-sm border border-charcoal/20 px-3 py-2 text-sm text-umber focus:border-charcoal focus:outline-none disabled:opacity-50"
        />
        {showCountError ? (
          <p id="quote-count-error" className="text-xs text-sienna">
            {countError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="quote-price" className="text-sm font-medium text-charcoal">
          Price per fraction
        </label>
        <div className="flex items-center gap-2">
          <input
            id="quote-price"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={price}
            disabled={disabled}
            onChange={(e) => setPrice(e.target.value.trim())}
            onBlur={() => setTouched((t) => ({ ...t, price: true }))}
            aria-invalid={showPriceError ? true : undefined}
            aria-describedby={showPriceError ? 'quote-price-error' : undefined}
            className="w-full rounded-sm border border-charcoal/20 px-3 py-2 text-sm text-umber focus:border-charcoal focus:outline-none disabled:opacity-50"
          />
          <span className="text-sm font-medium text-charcoal/70">USDC</span>
        </div>
        {showPriceError ? (
          <p id="quote-price-error" className="text-xs text-sienna">
            {priceError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="quote-validity" className="text-sm font-medium text-charcoal">
          Quote valid for
        </label>
        <select
          id="quote-validity"
          value={validity}
          disabled={disabled}
          onChange={(e) => {
            // Runtime-check membership instead of asserting it — the value comes from VALIDITY_PRESETS
            // options, but this proves it rather than casting a raw number.
            const next = Number(e.target.value);
            if ((VALIDITY_PRESETS as readonly number[]).includes(next)) {
              setValidity(next as ValidityHours);
            }
          }}
          className="rounded-sm border border-charcoal/20 px-3 py-2 text-sm text-umber focus:border-charcoal focus:outline-none disabled:opacity-50"
        >
          {VALIDITY_PRESETS.map((h) => (
            <option key={h} value={h}>
              {VALIDITY_LABELS[h]}
            </option>
          ))}
        </select>
      </div>

      {/* aria-live (no role="status") so AT is notified when the preview recomputes, without adding a second
          "status" landmark that would collide with the panel's pending/in-flight status regions. */}
      <p aria-live="polite" className="text-sm text-charcoal/70">
        You’d receive <span className={MONEY_FIGURE}>{preview ?? '—'}</span> USDC if the quote
        fills.
      </p>

      <button
        type="submit"
        disabled={disabled || !base}
        aria-busy={disabled || undefined}
        className={`${PRIMARY_BUTTON} self-start`}
      >
        {disabled ? 'Submitting…' : 'Submit quote'}
      </button>
    </form>
  );
}
