import { STROOPS_PER_USDC, USDC_DECIMALS } from '@/lib/money/constants';

// Pure amount/countdown helpers, feature-neutral (promoted out of lib/offerings/format.ts, TOV-173). Amounts
// are i128-safe DECIMAL STRINGS; BigInt is transient inside each function and never leaves — a bigint egress
// field would throw on JSON.stringify across the RSC/Server-Action (Flight) boundary. All math is exact (no
// floats), so values > 2^53 stay precise. BigInt(0)/BigInt(...) not `n` literals (tsconfig target predates
// ES2020 BigInt literals — pnpm build rejects them).

// escrowAmountStroops = price × count. The one place two i128 quantities multiply; a Number()-based product
// would silently overflow past 2^53, so the BigInt path is load-bearing, not cosmetic.
export function escrowAmount(priceStroops: string, count: number): string {
  return (BigInt(priceStroops) * BigInt(count)).toString();
}

// String × string product for two i128-scale decimal integers — the quote-acceptance SEC-5 gate multiplies
// pricePerFractionStroops × fractionCount where BOTH are numeric(39,0) STRINGS (not a JS number). Distinct from
// escrowAmount (whose count is a `number`, safe only ≤ 2^53): passing an i128 fractionCount through Number()
// would truncate. Both operands must match /^\d+$/ (BigInt throws otherwise) — callers pass validated strings.
export function mulStroops(a: string, b: string): string {
  return (BigInt(a) * BigInt(b)).toString();
}

// Parse a USDC decimal string ("0.5", "10", "10.0000000") to stroops WITHOUT floats. Rejects malformed
// input and anything finer than 7 dp (never rounds — a truncated cent is a money bug). Sub-USDC is valid:
// "0.5" → "5000000". `fracPadded` is right-padded to 7 so "0.5" contributes 5_000_000 stroops, not 5.
export function usdcToStroops(
  input: string,
): { ok: true; stroops: string } | { ok: false; reason: 'invalid' | 'too-precise' } {
  if (!/^\d+(\.\d+)?$/.test(input)) return { ok: false, reason: 'invalid' };
  // The regex guarantees a leading digit group; the `= '0'` default only satisfies the compiler's
  // noUncheckedIndexedAccess (split() elements are typed `string | undefined`).
  const [whole = '0', frac = ''] = input.split('.');
  if (frac.length > USDC_DECIMALS) return { ok: false, reason: 'too-precise' };
  const fracPadded = frac.padEnd(USDC_DECIMALS, '0');
  const stroops = BigInt(whole) * STROOPS_PER_USDC + BigInt(fracPadded);
  return { ok: true, stroops: stroops.toString() };
}

// Inverse of usdcToStroops — "5000000" → "0.5000000". Always emits the canonical 7-dp form (padStart) so
// the round-trip is stable. Input is a validated decimal-integer string; a malformed value is drift → throw
// (fail-closed) rather than silently coerce a negative/decimal past the BigInt boundary.
export function stroopsToUsdc(stroops: string): string {
  if (!/^\d+$/.test(stroops)) {
    throw new RangeError(`stroopsToUsdc: expected a decimal-integer string, got "${stroops}"`);
  }
  const value = BigInt(stroops);
  const whole = value / STROOPS_PER_USDC;
  const frac = value % STROOPS_PER_USDC;
  return `${whole.toString()}.${frac.toString().padStart(USDC_DECIMALS, '0')}`;
}

// Human display, e.g. "1000000000" → "100.00". Groups the integer part as a BigInt (exact past 2^53 —
// Intl.NumberFormat.format's string overload is a StringNumericLiteral, not a general string, so a plain
// decimal string isn't type-assignable), then appends the fractional part with trailing zeros trimmed to
// between 2 (cents) and 7 (USDC precision) digits.
// Hoisted so the (comparatively expensive) Intl constructor runs once, not per call — formatUsdc is on the
// keystroke path of the RFQ/quote money previews.
const USD_GROUP = new Intl.NumberFormat('en-US');

export function formatUsdc(stroops: string): string {
  const [whole = '0', frac = ''] = stroopsToUsdc(stroops).split('.');
  const grouped = USD_GROUP.format(BigInt(whole));
  const trimmed = frac.replace(/0+$/, '');
  const shown = trimmed.length >= 2 ? trimmed : frac.slice(0, 2);
  return `${grouped}.${shown}`;
}

// Group a plain (non-scaled) integer count string, e.g. "1234567" → "1,234,567". Used for the provenance
// timeline's fraction counts. Guarded so a malformed value degrades to the raw string rather than throwing in a
// render path (unlike stroopsToUsdc, which fails-closed by throwing) — timeline cards must never crash a page.
export function formatCount(value: string): string {
  if (!/^\d+$/.test(value)) return value;
  return USD_GROUP.format(BigInt(value));
}

// Clamp a price into an inclusive [low, high] band. Returns the original string on each edge so the caller
// keeps its canonical form; only replaces when out of band.
export function clampToBand(priceStroops: string, lowStroops: string, highStroops: string): string {
  const price = BigInt(priceStroops);
  if (price < BigInt(lowStroops)) return lowStroops;
  if (price > BigInt(highStroops)) return highStroops;
  return priceStroops;
}

// Band membership test (inclusive on both edges).
export function isWithinBand(
  priceStroops: string,
  lowStroops: string,
  highStroops: string,
): boolean {
  const price = BigInt(priceStroops);
  return price >= BigInt(lowStroops) && price <= BigInt(highStroops);
}

// Countdown breakdown toward `targetIso`, deterministic on the injected `nowMs` (never reads the clock — the
// caller owns a single `nowMs`-in-effect so SSR and the ticking client agree). Clamped at 0: at/after the
// target, everything is 0 and `expired` is true (the boundary counts as reached).
export function countdownParts(
  targetIso: string,
  nowMs: number,
): {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
} {
  const totalMs = Math.max(0, new Date(targetIso).getTime() - nowMs);
  const totalSeconds = Math.floor(totalMs / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return { totalMs, days, hours, minutes, seconds, expired: totalMs === 0 };
}
