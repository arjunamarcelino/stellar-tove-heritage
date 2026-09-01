/**
 * Lifecycle of a `secondary_trades` row (TOV-177, FR-06.04+06.05). A trade is created `pending` when a buyer
 * submits an accept (the row IS the double-accept latch); the async settle worker transitions it forward-only
 * to `settled` (chain-confirmed) or `failed` (a `is_settled==false` revert). Dependency-free leaf so both the
 * entity and pipe-layer DTOs can import it without pulling TypeORM.
 */
export const SECONDARY_TRADE_STATUSES = ['pending', 'settled', 'failed'] as const;

export type SecondaryTradeStatus = (typeof SECONDARY_TRADE_STATUSES)[number];
