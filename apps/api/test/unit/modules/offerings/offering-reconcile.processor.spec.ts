import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OfferingReconcileProcessor } from '../../../../src/modules/offerings/deploy/offering-reconcile.processor';
import { AUDIT_KIND } from '../../../../src/modules/wallets/audit/audit-log.types';

/**
 * Unit specs for the reconcile sweeper (TOV-154, WS8). Two DB-only promote-only sweeps per tick, each
 * bounded by `reconcileBatch` and isolated per item (a failing row logs + continues). Constructor
 * injection order (see the processor): offerings, approvals, cfg, audit. `process()` runs both sweeps.
 */

const CFG = { reconcileBatch: 20, ttlDays: 7, deployGraceMs: 120_000 } as never;

function build(
  overrides: {
    due?: Array<{ id: string }>;
    expiredIds?: string[];
    stale?: Array<{ id: string }>;
    casOpenedImpl?: () => Promise<boolean>;
  } = {},
) {
  const manager = { __tag: 'manager' };

  const offerings = {
    findDueForOpen: vi.fn(() => Promise.resolve(overrides.due ?? [])),
    findStaleDeploying: vi.fn(() => Promise.resolve(overrides.stale ?? [])),
    runInTransaction: vi.fn((cb: (m: unknown) => Promise<unknown>) => cb(manager)),
    casOpened: vi.fn(overrides.casOpenedImpl ?? (() => Promise.resolve(true))),
  };
  const approvals = {
    findExpiredOfferingIds: vi.fn(() => Promise.resolve(overrides.expiredIds ?? [])),
    softDeleteAllForOffering: vi.fn(() => Promise.resolve(undefined)),
  };
  const deployQueue = { add: vi.fn(() => Promise.resolve(undefined)) };
  const audit = { record: vi.fn(() => Promise.resolve(undefined)) };

  const processor = new OfferingReconcileProcessor(
    offerings as never,
    approvals as never,
    CFG,
    deployQueue as never,
    audit as never,
  );

  return { processor, offerings, approvals, deployQueue, audit };
}

/** Kinds audited across BOTH sweeps in one tick (helper to filter). */
const auditedKinds = (audit: { record: { mock: { calls: unknown[][] } } }) =>
  audit.record.mock.calls.map((c) => (c[0] as { kind: string }).kind);

describe('OfferingReconcileProcessor.process', () => {
  beforeEach(() => vi.clearAllMocks());

  it('U18a: stale-deploying sweep — re-enqueues each wedged deploying row (fresh per-attempt jobId)', async () => {
    const h = build({ stale: [{ id: 'o1' }, { id: 'o2' }] });
    await h.processor.process();

    expect(h.offerings.findStaleDeploying).toHaveBeenCalledWith(120_000, 20);
    expect(h.deployQueue.add).toHaveBeenCalledTimes(2);
    const jobIds = h.deployQueue.add.mock.calls.map((c) => (c[2] as { jobId: string }).jobId);
    expect(jobIds[0]).toMatch(/^deploy:o1:/);
    expect(jobIds[1]).toMatch(/^deploy:o2:/);
  });

  it('U18b: stale-deploying re-enqueue failure is isolated (one bad row does not abort the tick)', async () => {
    const h = build({ stale: [{ id: 'o1' }, { id: 'o2' }] });
    h.deployQueue.add.mockRejectedValueOnce(new Error('redis down'));
    await expect(h.processor.process()).resolves.toBeUndefined();
    expect(h.deployQueue.add).toHaveBeenCalledTimes(2); // o2 still attempted after o1 threw
  });

  it('U18c: no stale rows → no enqueue', async () => {
    const h = build({ stale: [] });
    await h.processor.process();
    expect(h.deployQueue.add).not.toHaveBeenCalled();
  });

  it('U19: window-open sweep — casOpened=true → audit OFFERING_OPENED', async () => {
    const h = build({ due: [{ id: 'o1' }], casOpenedImpl: () => Promise.resolve(true) });
    await h.processor.process();

    expect(h.offerings.casOpened).toHaveBeenCalledWith(expect.anything(), 'o1');
    expect(auditedKinds(h.audit)).toEqual([AUDIT_KIND.OFFERING_OPENED]);
  });

  it('U19: window-open sweep — casOpened=false → no audit', async () => {
    const h = build({ due: [{ id: 'o1' }], casOpenedImpl: () => Promise.resolve(false) });
    await h.processor.process();

    expect(h.offerings.casOpened).toHaveBeenCalledOnce();
    expect(h.audit.record).not.toHaveBeenCalled();
  });

  it('U20: expiry sweep — softDeleteAllForOffering + audit OFFERING_APPROVAL_EXPIRED', async () => {
    const h = build({ expiredIds: ['id1'] });
    await h.processor.process();

    expect(h.approvals.softDeleteAllForOffering).toHaveBeenCalledWith(expect.anything(), 'id1');
    expect(auditedKinds(h.audit)).toEqual([AUDIT_KIND.OFFERING_APPROVAL_EXPIRED]);
    // ttlMs passed to the finder = ttlDays * 24 * 60 * 60 * 1000
    expect(h.approvals.findExpiredOfferingIds).toHaveBeenCalledWith(7 * 86_400_000, 20);
  });

  it('U21: per-item isolation — casOpened throws for o1, sweep continues and processes o2', async () => {
    const casOpened = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(true);
    const h = build({ due: [{ id: 'o1' }, { id: 'o2' }] });
    h.offerings.casOpened = casOpened as never;

    await expect(h.processor.process()).resolves.toBeUndefined();

    // both items attempted; o2 still audited despite o1 throwing
    expect(casOpened).toHaveBeenCalledTimes(2);
    expect(h.audit.record).toHaveBeenCalledOnce();
    expect(h.audit.record.mock.calls[0][0]).toMatchObject({
      kind: AUDIT_KIND.OFFERING_OPENED,
      subjectId: 'o2',
    });
  });

  it('U22: empty sweeps → no audit calls', async () => {
    const h = build({ due: [], expiredIds: [] });
    await h.processor.process();

    expect(h.audit.record).not.toHaveBeenCalled();
    expect(h.approvals.softDeleteAllForOffering).not.toHaveBeenCalled();
    expect(h.offerings.casOpened).not.toHaveBeenCalled();
  });
});
