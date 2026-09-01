import { registerAs } from '@nestjs/config';

/**
 * RFQ notification fan-out config (TOV-174, FR-06.02). No signing secret — fan-out is a pure DB write.
 *
 * The worker delivers immediately off the RFQ-create request path (best-effort enqueue); the reconcile
 * sweep is the crash-between-commit-and-enqueue backstop that upholds the 99%/60s SLA. `reconcileEnabled`
 * is disabled in tests so the scheduler doesn't fire under Vitest. `reconcileWindowMs` (24h) must be >= the
 * job retry horizon; RFQs older than the window that crashed pre-enqueue are orphaned (accepted).
 */
export const rfqFanoutConfig = registerAs('rfqFanout', () => ({
  // Crash-window reconcile sweeper (re-enqueue only). Disabled in tests.
  reconcileEnabled: (process.env.RFQ_FANOUT_RECONCILE_ENABLED ?? 'true') === 'true',
  reconcileCron: process.env.RFQ_FANOUT_RECONCILE_CRON ?? '* * * * *',
  reconcileWindowMs: parseInt(process.env.RFQ_FANOUT_RECONCILE_WINDOW_MS ?? '86400000', 10),
  // Recency lower-bound: the sweep only re-drives RFQs whose primary fan-out job has had time to run AND
  // exhaust its retries (attempts:5 exp backoff ≈ 62s). Must exceed that horizon so a still-retrying job
  // isn't needlessly re-enqueued as a redundant (latch-idempotent) sibling. Mirrors fraction reconcileGraceMs.
  reconcileGraceMs: parseInt(process.env.RFQ_FANOUT_RECONCILE_GRACE_MS ?? '120000', 10),
  reconcileBatch: parseInt(process.env.RFQ_FANOUT_RECONCILE_BATCH ?? '100', 10),
  // NOTE: worker concurrency is intentionally NOT a config field. The @Processor decorator is evaluated
  // pre-DI, so it reads RFQ_FANOUT_WORKER_CONCURRENCY from process.env directly (still Joi-validated at boot).
  // A config field here would be dead weight that silently never takes effect (todo 363).
}));

export type RfqFanoutConfig = ReturnType<typeof rfqFanoutConfig>;
