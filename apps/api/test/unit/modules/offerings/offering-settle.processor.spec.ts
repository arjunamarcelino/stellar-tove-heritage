import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import { OfferingSettleProcessor } from '../../../../src/modules/offerings/settle/offering-settle.processor';
import { FakeOfferingEscrowService } from '../../../shared/fake-offering-escrow.service';
import { AUDIT_KIND } from '../../../../src/modules/wallets/audit/audit-log.types';
import { OfferingEscrowThrottledError } from '../../../../src/modules/offerings/escrow/offering-escrow.errors';

const OFFERING_ID = '11111111-1111-4111-8111-111111111111';

/** float 100: bid1 100×80 (win 80), bid2 90×50 (win 20 marginal, P=90), bid3 80×50 (loses). */
function escrowedBids() {
  const mk = (chainBidId: number, price: bigint, count: bigint, t: number) => ({
    id: `row-${chainBidId}`,
    chainBidId,
    collectorSub: `sub-${chainBidId}`,
    priceStroops: price.toString(),
    count: count.toString(),
    escrowAmountStroops: (price * count).toString(),
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, t)),
  });
  return [mk(1, 100n, 80n, 1), mk(2, 90n, 50n, 2), mk(3, 80n, 50n, 3)];
}

function build(overrides: { status?: string; escrowStatus?: 'open' | 'closed' | 'settled'; inflight?: number } = {}) {
  const escrow = new FakeOfferingEscrowService();
  const escrowAddress = escrow.addressFor(OFFERING_ID);
  if (overrides.escrowStatus) escrow.setStatus(escrowAddress, overrides.escrowStatus);

  const offering = {
    id: OFFERING_ID,
    status: overrides.status ?? 'subscribed',
    escrowContractAddress: escrowAddress,
    escrowDeployStatus: 'deployed',
    publicFloat: '100',
    // TOV-165 planning snapshot (150 − 30 − 20 = 100 = publicFloat).
    totalSupplyStroops: '150',
    artistRetentionStroops: '30',
    treasuryRetentionStroops: '20',
    lowPriceStroops: '1',
    highPriceStroops: '1000000000',
  };

  const offerings = {
    findOneById: vi.fn(() => Promise.resolve(offering)),
    runInTransaction: vi.fn((cb: (m: unknown) => Promise<unknown>) => cb({})),
    casSettled: vi.fn(() => Promise.resolve(true)),
    setSettleFailureStamp: vi.fn(() => Promise.resolve(true)),
  };
  const bids = {
    listBidsForClearing: vi.fn(() => Promise.resolve(escrowedBids())),
    countInflight: vi.fn(() => Promise.resolve(overrides.inflight ?? 0)),
    casWon: vi.fn(() => Promise.resolve(true)),
    flipRemainingEscrowedToLost: vi.fn(() => Promise.resolve(1)), // bid3
  };
  const clearingAudit = { insertSnapshot: vi.fn(() => Promise.resolve({ id: 'audit-1' })) };
  const audit = { record: vi.fn(() => Promise.resolve(undefined)) };
  const cfg = { maxBidsPerOffering: 40 } as never;

  const proc = new OfferingSettleProcessor(
    offerings as never,
    bids as never,
    clearingAudit as never,
    escrow,
    cfg,
    audit as never,
  );
  return { proc, offerings, bids, clearingAudit, audit, escrow, escrowAddress };
}

const run = (h: ReturnType<typeof build>) => h.proc.process({ data: { offeringId: OFFERING_ID } } as never);

describe('OfferingSettleProcessor — money-safe settlement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('U17 no-op unless the offering is in the subscribed latch', async () => {
    const h = build({ status: 'opened' });
    await run(h);
    expect(h.escrow.settleCalls).toHaveLength(0);
    expect(h.offerings.casSettled).not.toHaveBeenCalled();
  });

  it('U19+U21 open → close_offering then close_and_settle, casSettled + won/lost flip + audit (one txn)', async () => {
    const h = build({ escrowStatus: 'open' });
    await run(h);
    expect(h.escrow.closeCalls).toEqual([OFFERING_ID]);
    expect(h.escrow.settleCalls).toHaveLength(1);
    // P=90; winners (1,80) and (2,20) passed to close_and_settle.
    expect(h.escrow.settleCalls[0].clearingPrice).toBe(90n);
    expect(h.escrow.settleCalls[0].allocations).toEqual([
      { bidId: 1, allocated: 80n },
      { bidId: 2, allocated: 20n },
    ]);
    expect(h.offerings.casSettled).toHaveBeenCalledOnce();
    expect(h.bids.casWon).toHaveBeenCalledTimes(2); // two winners
    expect(h.bids.flipRemainingEscrowedToLost).toHaveBeenCalledOnce(); // the loser
    expect(h.clearingAudit.insertSnapshot).toHaveBeenCalledOnce();
    const snap = h.clearingAudit.insertSnapshot.mock.calls[0][1];
    expect(snap.clearingPriceStroops).toBe('90');
    expect(snap.adopted).toBe(false);
    // TOV-165 mint-conservation snapshot: cleared = Σ winners (80+20=100) == publicFloat; absorbed ≡ 0;
    // supply/retentions copied from the offering's planning snapshot.
    expect(snap.clearedAllocationsStroops).toBe('100');
    expect(snap.absorbedLeftoverStroops).toBe('0');
    expect(snap.totalSupplyStroops).toBe('150');
    expect(snap.artistRetentionStroops).toBe('30');
    expect(snap.treasuryRetentionStroops).toBe('20');
    const settledAudit = h.audit.record.mock.calls.find((c) => c[0].kind === AUDIT_KIND.OFFERING_SETTLED);
    expect(settledAudit).toBeDefined();
  });

  it('U18 self-heal: readStatus==settled → adopt (casSettled + audit adopted, NO close_and_settle)', async () => {
    const h = build({ escrowStatus: 'settled' });
    await run(h);
    expect(h.escrow.closeCalls).toHaveLength(0);
    expect(h.escrow.settleCalls).toHaveLength(0); // no on-chain settle — adopted
    expect(h.offerings.casSettled).toHaveBeenCalledOnce();
    const snap = h.clearingAudit.insertSnapshot.mock.calls[0][1];
    expect(snap.adopted).toBe(true);
    expect(snap.settlementTxHash).toBeNull();
    // TOV-165 G2 adopt-path parity: the 5 mint-conservation columns are present on the adopt path too
    // (both paths funnel through the single persist(); a regression here would be invisible without this).
    expect(snap.clearedAllocationsStroops).toBe('100');
    expect(snap.absorbedLeftoverStroops).toBe('0');
    expect(snap.totalSupplyStroops).toBe('150');
    expect(snap.artistRetentionStroops).toBe('30');
    expect(snap.treasuryRetentionStroops).toBe('20');
  });

  it('U20 post-close in-flight bid → re-throw (retryable), no settle', async () => {
    const h = build({ escrowStatus: 'closed', inflight: 1 });
    await expect(run(h)).rejects.toBeInstanceOf(OfferingEscrowThrottledError);
    expect(h.escrow.settleCalls).toHaveLength(0);
    expect(h.offerings.setSettleFailureStamp).not.toHaveBeenCalled(); // NOT stamped failed (retryable stays subscribed)
  });

  it('U22 retryable escrow error → re-throw, stays subscribed (never stamps failure)', async () => {
    const h = build({ escrowStatus: 'closed' });
    h.escrow.settleThrottleOn = new Set([OFFERING_ID]);
    await expect(run(h)).rejects.toBeInstanceOf(OfferingEscrowThrottledError);
    expect(h.offerings.casSettled).not.toHaveBeenCalled();
    expect(h.offerings.setSettleFailureStamp).not.toHaveBeenCalled();
  });

  it('U23 terminal contract error → stamp OFFERING_SETTLE_FAILED (stays subscribed) + Unrecoverable', async () => {
    const h = build({ escrowStatus: 'closed' });
    h.escrow.settleFailOn = new Set([OFFERING_ID]);
    await expect(run(h)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(h.offerings.casSettled).not.toHaveBeenCalled();
    expect(h.offerings.setSettleFailureStamp).toHaveBeenCalledOnce();
    const failAudit = h.audit.record.mock.calls.find((c) => c[0].kind === AUDIT_KIND.OFFERING_SETTLE_FAILED);
    expect(failAudit).toBeDefined();
  });

  it('U24 transient (non-domain) error during the flow → retryable re-throw, NOT stamped failed (#321)', async () => {
    const h = build({ escrowStatus: 'closed' });
    // A plain infra error (e.g. a DB blip) from a repo read is NOT deterministic → must re-throw retryable.
    h.bids.listBidsForClearing = vi.fn(() => Promise.reject(new Error('connection reset')));
    await expect(run(h)).rejects.toThrow('connection reset');
    expect(h.offerings.setSettleFailureStamp).not.toHaveBeenCalled();
    expect(h.offerings.casSettled).not.toHaveBeenCalled();
  });
});
