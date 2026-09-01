/**
 * RFQ notification fan-out (TOV-174, FR-06.02) shared leaf constants + types. Dependency-free (no entity
 * import) so producers, the worker, and DTOs share them without pulling TypeORM — mirrors
 * `offering-bid-status.constant.ts` / `rfq-status.constant.ts`.
 */

/** BullMQ queue that carries one fan-out job per created RFQ. */
export const RFQ_FANOUT_QUEUE = 'rfq-fanout';

/** BullMQ queue for the repeatable reconcile sweep (crash / retry-exhaustion backstop). */
export const RFQ_FANOUT_RECONCILE_QUEUE = 'rfq-fanout-reconcile';

/** The single job name on {@link RFQ_FANOUT_QUEUE}; shared by the producer AND the reconcile re-enqueue. */
export const RFQ_FANOUT_JOB = 'fanout';

/**
 * Repeatable-job name for the reconcile scheduler (distinct from the QUEUE name so a rename of one doesn't
 * confusingly track the other; mirrors the fraction scheduler's plain `'reconcile'` job name). Stable across
 * boots so `onModuleInit` re-registration is idempotent (BullMQ dedups a repeatable by its (name, repeat) key).
 */
export const RFQ_FANOUT_SCHEDULER_KEY = 'reconcile';

/**
 * Delivery channels. Only `in_app` exists this ticket; `email` is a future discriminated-union seam (NOT a
 * flat status enum). Bound as a tuple-as-const so the CHECK belt in migration 042 and the entity type can
 * never drift.
 */
export const NOTIFICATION_CHANNELS = ['in_app'] as const;
export type RfqNotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Inbox `?filter=` values. `unread` → only `read_at IS NULL`; `all` (or omitted) → everything. */
export const NOTIFICATION_FILTERS = ['unread', 'all'] as const;
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

/** The BullMQ job payload — one field, but typed once so producer/worker/reconcile can't drift to `any`. */
export interface RfqFanoutJobData {
  rfqId: string;
}

/**
 * Shared enqueue options (retry/backoff/retention) for the `rfq-fanout` job — the ONE coupling contract the
 * producer AND the reconcile re-enqueue must keep in lockstep. `jobId` is intentionally NOT here: the producer
 * uses `jobId=rfqId` (dedups a duplicate create-time enqueue), while reconcile uses a UNIQUE jobId so a
 * retained *failed* primary job can never dedup the re-drive to a silent no-op (correctness rests on the DB
 * latch + unique index, not on jobId). `attempts` × exp backoff ≈ 62s — the reconcile grace must exceed it.
 */
export const RFQ_FANOUT_JOB_OPTS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86400 },
};

/** A new notification row to insert (the DB defaults `channel='in_app'`). `recipient_sub` is a user id (JWT sub). */
export interface NewRfqNotification {
  rfqId: string;
  recipientSub: string;
  artworkId: string;
}

/**
 * Deterministic terminal marker: the fan-out target RFQ is gone (missing/soft-deleted) — retrying can never
 * succeed. The processor maps this to BullMQ `UnrecoverableError` while keeping `RfqFanoutService`
 * framework-agnostic (no `bullmq` import in the service).
 */
export class TerminalFanoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TerminalFanoutError';
  }
}
