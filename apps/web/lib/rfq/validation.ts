import { EXPIRY_PRESETS } from '@/lib/rfq/constants';
import { RFQ_MESSAGES } from '@/lib/rfq/rfqMessages';
import { I128_MAX, U96_MAX } from '@/lib/money/constants';
import type { CreateRfqResult, RfqErrorCode, RfqInput } from '@/lib/types/api';

// Shared RFQ input-bounds check (TOV-173). Used by BOTH the server action (the trust boundary) and the
// service (fail-closed defense-in-depth) so the rules can't drift — a single source for: the two INDEPENDENT
// numeric ceilings (per-fraction price ≤ u96, price × count ≤ i128), the integer count ≥ 1, and the expiry
// allow-list. Returns a curated error result, or null when the input is valid. The regex/BigInt guards
// tolerate a forged numeric value (a Server Action deserializes arbitrary client payloads).

const err = (code: RfqErrorCode): CreateRfqResult => ({
  status: 'error',
  code,
  message: RFQ_MESSAGES[code],
});

export function checkRfqBounds(input: RfqInput): CreateRfqResult | null {
  const price = input.maxPricePerFractionStroops;
  if (!/^[1-9]\d*$/.test(price) || BigInt(price) > U96_MAX) return err('RFQ_INVALID_PRICE');
  if (!Number.isSafeInteger(input.fractionCount) || input.fractionCount < 1) {
    return err('VALIDATION_FAILED');
  }
  if (!EXPIRY_PRESETS.includes(input.expiryHours)) return err('VALIDATION_FAILED');
  if (BigInt(price) * BigInt(input.fractionCount) > I128_MAX) return err('RFQ_AMOUNT_OVERFLOW');
  return null;
}
