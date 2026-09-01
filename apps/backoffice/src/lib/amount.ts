/**
 * BigInt-only formatting for i128 base-unit ("stroops") integer strings. NEVER uses `Number`,
 * `parseFloat`, `/`, or `toFixed` on a money value — those lose precision above 2^53. Introduced for
 * the offerings feature (no prior on-chain-amount helper existed); kept generic in `lib/`.
 */

// Default asset scale (base units → whole units). Stellar-standard 7. Change here (or the symbol below)
// once the payment asset is confirmed — the formatter is otherwise parameterized.
export const DECIMALS = 7;

// Reused module-scope formatter (constructing `Intl.NumberFormat` per call is the real cost).
const groupFormatter = new Intl.NumberFormat('en-US');

// Hoisted BigInt constants (avoid per-call allocation in the format hot path).
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);

interface FormatStroopsOptions {
  /** Append a symbol, e.g. " XLM". */
  symbol?: string;
  /** Thousands-group the integer part (default true). */
  group?: boolean;
  /** Rounding when reducing to `displayDecimals` (default 'half-up' = away from zero). */
  rounding?: 'half-up' | 'trunc';
}

/**
 * Format an i128 base-unit integer string as a decimal string.
 *
 * @param raw             integer string in base units ("1234567"); digits only, optional leading '-'.
 * @param decimals        asset scale (default {@link DECIMALS}).
 * @param displayDecimals fixed fractional digits to SHOW. Omit ⇒ full precision (trailing zeros trimmed,
 *                        no rounding). Load-bearing values (e.g. an approvable price band) MUST omit this.
 * @param opts            symbol / grouping / rounding.
 */
export function formatStroops(
  raw: string,
  decimals = DECIMALS,
  displayDecimals?: number,
  opts: FormatStroopsOptions = {},
): string {
  // Never trust the wire even after `z.string()`; a loud throw beats silent corruption.
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`formatStroops: non-integer input ${JSON.stringify(raw)}`);
  }

  const negative = raw.startsWith('-');
  let magnitude = BigInt(negative ? raw.slice(1) : raw); // always >= 0

  // Optionally round from `decimals` places down to `displayDecimals` places — integer math only.
  // (`BigInt()` constructor, not `n`-literals, so this compiles under the project's sub-ES2020 target.)
  let scale = decimals;
  if (displayDecimals !== undefined && displayDecimals < decimals) {
    const drop = TEN ** BigInt(decimals - displayDecimals);
    const quotient = magnitude / drop;
    const remainder = magnitude % drop;
    magnitude = opts.rounding === 'trunc' ? quotient : remainder * TWO >= drop ? quotient + ONE : quotient;
    scale = displayDecimals;
  }

  const scaleBase = TEN ** BigInt(scale);
  const intPart = magnitude / scaleBase;
  // `scale === 0` (e.g. `displayDecimals: 0` or `decimals: 0`) → no fractional part (avoid a spurious ".0").
  let frac = scale > 0 ? (magnitude % scaleBase).toString().padStart(scale, '0') : '';
  if (displayDecimals === undefined) {
    frac = frac.replace(/0+$/, ''); // full precision → trim trailing zeros
  } else if (displayDecimals > scale) {
    frac = frac.padEnd(displayDecimals, '0'); // requested more digits than the asset scale → pad out
  }

  const intStr = (opts.group ?? true) ? groupFormatter.format(intPart) : intPart.toString();
  const body = frac.length ? `${intStr}.${frac}` : intStr;
  const signed = negative && magnitude !== ZERO ? `-${body}` : body;
  return opts.symbol ? `${signed} ${opts.symbol}` : signed;
}
