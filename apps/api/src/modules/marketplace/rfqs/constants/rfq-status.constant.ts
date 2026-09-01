/**
 * RFQ lifecycle (TOV-172, FR-06.01). An RFQ is created `open`; the later marketplace FRs move it to a
 * terminal state (`filled` when a quote is accepted, `canceled` by the collector, `expired` past
 * `expires_at`). Homed as a dependency-free leaf (like `offering-status.constant.ts`) so the entity and
 * pipe-layer DTOs import the type without pulling the TypeORM entity.
 */
export const RFQ_STATUSES = ['open', 'filled', 'canceled', 'expired'] as const;

export type RfqStatus = (typeof RFQ_STATUSES)[number];
