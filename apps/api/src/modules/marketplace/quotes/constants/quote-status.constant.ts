/**
 * Lifecycle of a quote (a holder's offer to SELL fractions in response to an RFQ; TOV-175, FR-06.03).
 * Created `open`; later FRs transition it forward-only: `accepted` (accept-and-settle, FR-06.04),
 * `canceled` (future cancel endpoint), `expired` (lazy-reaped when `valid_until` lapses, or a
 * seller-fault settlement revert; TOV-177), or `superseded` (a rival quote on the same RFQ won at accept;
 * TOV-177). Dependency-free leaf so both the entity and pipe-layer DTOs can import it without TypeORM.
 */
export const QUOTE_STATUSES = ['open', 'accepted', 'canceled', 'expired', 'superseded'] as const;

export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
