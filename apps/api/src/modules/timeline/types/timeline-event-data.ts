/**
 * Per-event-type public payload shapes (TOV-191). A structural union (NOT a tagged/discriminated one — there
 * is no shared discriminant field; the PII protection comes from the fixed-typed `emit*` inputs + the
 * read-side allowlist, and from excess-property checks on literal assignment): a writer cannot construct
 * `event_data` carrying PII — a `secondary_trade` payload with `buyerSub` won't typecheck.
 * Money fields are `string` (numeric(39,0) / i128) — never `number` (would lose precision).
 *
 * NB: `secondary_trade` deliberately OMITS `txHash` (resolved Open Q1) — a trade tx hash deanonymizes the
 * buyer/seller wallets. `fractionalization` keeps `txHash` (a system contract-deploy tx, no counterparty).
 */
export interface FractionalizationEventData {
  readonly tokenAddress: string;
  readonly deployLedger: string | null;
  readonly txHash?: string;
}

export interface SecondaryTradeEventData {
  readonly fractionCount: string;
  readonly pricePerFractionStroops: string;
  readonly settledAt: string;
}

/** `{}` for the schema-only event types that have no writer yet. */
export type TimelineEventData =
  | FractionalizationEventData
  | SecondaryTradeEventData
  | Record<string, never>;
