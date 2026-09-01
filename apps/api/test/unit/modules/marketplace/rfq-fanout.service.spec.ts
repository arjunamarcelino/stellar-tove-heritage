import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RfqFanoutService } from '../../../../src/modules/marketplace/notifications/fanout/rfq-fanout.service';
import { TerminalFanoutError } from '../../../../src/modules/marketplace/notifications/constants/rfq-notification.constants';
import { AUDIT_KIND } from '../../../../src/modules/wallets/audit/audit-log.types';

const RFQ_ID = '00000000-0000-4000-8000-0000000f0001';
const ARTWORK = '00000000-0000-4000-8000-0000000a0001';
const BUYER = '00000000-0000-4000-8000-00000000c001';
const W1 = '00000000-0000-4000-8000-00000000c002';
const W2 = '00000000-0000-4000-8000-00000000c003';

interface Overrides {
  rfq?: { id: string; artworkId: string; collectorSub: string; fannedOutAt: Date | null } | null;
  winners?: string[];
  latchWon?: boolean;
}

function build(overrides: Overrides = {}) {
  const rfqRow =
    'rfq' in overrides
      ? overrides.rfq
      : { id: RFQ_ID, artworkId: ARTWORK, collectorSub: BUYER, fannedOutAt: null };

  const winners = overrides.winners ?? [W1, W2];
  const notifications = {
    insertManyIgnoreConflicts: vi.fn(() => Promise.resolve()),
    // Exact count = the rows that exist; in the unit mock that equals the resolved winner set.
    countForRfq: vi.fn(() => Promise.resolve(winners.length)),
  };
  const rfqs = {
    findOneById: vi.fn(() => Promise.resolve(rfqRow)),
    latchFannedOut: vi.fn(() => Promise.resolve(overrides.latchWon ?? true)),
    runInTransaction: vi.fn((cb: (m: unknown) => Promise<unknown>) => cb({ MANAGER: true })),
  };
  const bids = {
    findSettledWinnerSubsForArtwork: vi.fn(() => Promise.resolve(overrides.winners ?? [W1, W2])),
  };
  const audit = { record: vi.fn(() => Promise.resolve(undefined)) };

  const service = new RfqFanoutService(
    rfqs as never,
    bids as never,
    notifications as never,
    audit as never,
  );
  return { service, rfqs, bids, notifications, audit };
}

describe('RfqFanoutService.fanout', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts one row per winner (buyer excluded upstream) and audits with recipientCount', async () => {
    const { service, notifications, bids, audit } = build({ winners: [W1, W2] });
    await service.fanout(RFQ_ID);

    // Recipient query excludes the buyer (passed as excludeSub).
    expect(bids.findSettledWinnerSubsForArtwork).toHaveBeenCalledWith(ARTWORK, BUYER);
    expect(notifications.insertManyIgnoreConflicts).toHaveBeenCalledTimes(1);
    const rows = notifications.insertManyIgnoreConflicts.mock.calls[0][1] as Array<{
      rfqId: string;
      recipientSub: string;
      artworkId: string;
    }>;
    expect(rows).toEqual([
      { rfqId: RFQ_ID, recipientSub: W1, artworkId: ARTWORK },
      { rfqId: RFQ_ID, recipientSub: W2, artworkId: ARTWORK },
    ]);
    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0][0] as { kind: string; subjectId: string; payload: unknown };
    expect(entry.kind).toBe(AUDIT_KIND.RFQ_NOTIFICATIONS_FANNED_OUT);
    expect(entry.subjectId).toBe(RFQ_ID);
    expect(entry.payload).toEqual({ recipientCount: 2 });
  });

  it('0-recipient RFQ still latches and audits (recipientCount 0) — never re-swept', async () => {
    const { service, rfqs, notifications, audit } = build({ winners: [] });
    await service.fanout(RFQ_ID);
    expect(notifications.insertManyIgnoreConflicts).toHaveBeenCalledWith(expect.anything(), []);
    expect(rfqs.latchFannedOut).toHaveBeenCalledTimes(1);
    expect((audit.record.mock.calls[0][0] as { payload: unknown }).payload).toEqual({ recipientCount: 0 });
  });

  it('does NOT audit when the CAS latch is lost to a concurrent worker', async () => {
    const { service, notifications, audit } = build({ winners: [W1], latchWon: false });
    await service.fanout(RFQ_ID);
    // Insert still ran (orIgnore dedups), but the losing worker must not write the audit row.
    expect(notifications.insertManyIgnoreConflicts).toHaveBeenCalledTimes(1);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('early-exits (no insert/latch/audit) when the RFQ is already latched', async () => {
    const { service, rfqs, bids, notifications, audit } = build({
      rfq: { id: RFQ_ID, artworkId: ARTWORK, collectorSub: BUYER, fannedOutAt: new Date() },
    });
    await service.fanout(RFQ_ID);
    expect(bids.findSettledWinnerSubsForArtwork).not.toHaveBeenCalled();
    expect(notifications.insertManyIgnoreConflicts).not.toHaveBeenCalled();
    expect(rfqs.latchFannedOut).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('throws TerminalFanoutError when the RFQ is missing/soft-deleted', async () => {
    const { service } = build({ rfq: null });
    await expect(service.fanout(RFQ_ID)).rejects.toBeInstanceOf(TerminalFanoutError);
  });
});
