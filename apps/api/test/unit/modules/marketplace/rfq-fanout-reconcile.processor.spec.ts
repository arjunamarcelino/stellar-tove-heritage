import { describe, it, expect, vi } from 'vitest';
import { RfqFanoutReconcileProcessor } from '../../../../src/modules/marketplace/notifications/fanout/rfq-fanout-reconcile.processor';
import { RFQ_FANOUT_JOB } from '../../../../src/modules/marketplace/notifications/constants/rfq-notification.constants';

const CFG = { reconcileWindowMs: 86_400_000, reconcileGraceMs: 120_000, reconcileBatch: 100 };

describe('RfqFanoutReconcileProcessor', () => {
  it('re-drives each stalled RFQ with a UNIQUE jobId (never dedups against a retained failed job)', async () => {
    const rfqs = { findUnfannedSince: vi.fn(() => Promise.resolve(['a', 'b'])) };
    const queue = { add: vi.fn(() => Promise.resolve(undefined)) };
    const proc = new RfqFanoutReconcileProcessor(CFG as never, rfqs as never, queue as never);

    await proc.process();

    expect(rfqs.findUnfannedSince).toHaveBeenCalledWith({ windowMs: 86_400_000, graceMs: 120_000, limit: 100 });
    expect(queue.add).toHaveBeenCalledTimes(2);
    // jobId is `${rfqId}:reconcile:${ts}` — distinct from the producer's jobId=rfqId, so a retained failed
    // primary job can't dedup the re-drive to a no-op.
    const calls = queue.add.mock.calls as Array<[string, { rfqId: string }, { jobId: string; attempts: number }]>;
    expect(calls[0][0]).toBe(RFQ_FANOUT_JOB);
    expect(calls[0][1]).toEqual({ rfqId: 'a' });
    expect(calls[0][2].jobId).toMatch(/^a:reconcile:\d+$/);
    expect(calls[0][2].attempts).toBe(5);
    expect(calls[1][1]).toEqual({ rfqId: 'b' });
    expect(calls[1][2].jobId).toMatch(/^b:reconcile:\d+$/);
  });

  it('no-ops when nothing is un-latched', async () => {
    const rfqs = { findUnfannedSince: vi.fn(() => Promise.resolve([])) };
    const queue = { add: vi.fn() };
    const proc = new RfqFanoutReconcileProcessor(CFG as never, rfqs as never, queue as never);
    await proc.process();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
