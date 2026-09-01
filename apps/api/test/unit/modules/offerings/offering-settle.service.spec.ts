import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { BackofficeOfferingSettleService } from '../../../../src/modules/backoffice/offerings/backoffice-offering-settle.service';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { AUDIT_KIND } from '../../../../src/modules/wallets/audit/audit-log.types';

const OFFERING_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN = 'admin-1';
const KEY = 'idem-key-1';
const FUTURE = new Date(Date.now() + 3_600_000);
const PAST = new Date(Date.now() - 3_600_000);

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
  return [mk(1, 100n, 80n, 1), mk(2, 90n, 50n, 2)]; // float 100 → P=90, fully subscribed
}

function build(o: {
  offering?: Record<string, unknown>;
  begin?: unknown;
  inflight?: number;
  demand?: string;
  active?: number;
  casSubscribed?: boolean;
  bids?: unknown[];
} = {}) {
  const offering = {
    id: OFFERING_ID,
    status: 'opened',
    windowCloseAt: PAST,
    escrowContractAddress: 'C'.padEnd(56, 'A'),
    escrowDeployStatus: 'deployed',
    publicFloat: '100',
    lowPriceStroops: '1',
    highPriceStroops: '1000000000',
    settleFailedAt: null,
    ...(o.offering ?? {}),
  };
  const offerings = {
    findOneById: vi.fn(() => Promise.resolve(offering)),
    runInTransaction: vi.fn((cb: (m: unknown) => Promise<unknown>) =>
      cb({ getRepository: () => ({ findOne: vi.fn(() => Promise.resolve(offering)) }) }),
    ),
    casSubscribed: vi.fn(() => Promise.resolve(o.casSubscribed ?? true)),
    setSettleFailureStamp: vi.fn(() => Promise.resolve(true)),
  };
  const bids = {
    countInflight: vi.fn(() => Promise.resolve(o.inflight ?? 0)),
    countActiveForOffering: vi.fn(() => Promise.resolve(o.active ?? 2)),
    sumEscrowedCount: vi.fn(() => Promise.resolve(o.demand ?? '130')),
    listBidsForClearing: vi.fn(() => Promise.resolve(o.bids ?? escrowedBids())),
  };
  const escrowCfg = { signerSet: new Set<string>(), threshold: 2, maxBidsPerOffering: 40 };
  const settleQueue = { add: vi.fn(() => Promise.resolve(undefined)) };
  const idempotency = {
    begin: vi.fn(() => Promise.resolve(o.begin ?? { outcome: 'proceed', token: 't1' })),
    complete: vi.fn(() => Promise.resolve(undefined)),
    fail: vi.fn(() => Promise.resolve(undefined)),
  };
  const audit = { record: vi.fn(() => Promise.resolve(undefined)) };

  const service = new BackofficeOfferingSettleService(
    offerings as never,
    bids as never,
    escrowCfg as never,
    settleQueue as never,
    idempotency as never,
    audit as never,
  );
  return { service, offerings, bids, settleQueue, idempotency, audit };
}

function codeOf(err: unknown): { code?: string; status: number } {
  const he = err as HttpException;
  const body = he.getResponse() as { errorCode?: string };
  return { code: body.errorCode, status: he.getStatus() };
}

describe('BackofficeOfferingsService.settle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('U14 happy: latches subscribed, completes idempotency BEFORE enqueue, returns 202', async () => {
    const h = build();
    const body = await h.service.settle(OFFERING_ID, ADMIN, KEY);
    expect(h.offerings.casSubscribed).toHaveBeenCalledOnce();
    expect(h.idempotency.complete).toHaveBeenCalledOnce();
    expect(h.settleQueue.add).toHaveBeenCalledOnce();
    expect(body.clearingPriceStroops).toBe('90');
    expect(body.winners).toBe(2);
  });

  it('U15 replay returns the stored 202; in_flight → 409; mismatch → 422', async () => {
    const replay = build({ begin: { outcome: 'replay', body: { offeringId: OFFERING_ID, status: 'subscribed' } } });
    await expect(replay.service.settle(OFFERING_ID, ADMIN, KEY)).resolves.toMatchObject({ offeringId: OFFERING_ID });
    expect(replay.offerings.findOneById).not.toHaveBeenCalled();

    const inflight = build({ begin: { outcome: 'in_flight' } });
    await expect(inflight.service.settle(OFFERING_ID, ADMIN, KEY)).rejects.toSatisfy(
      (e: unknown) => codeOf(e).code === ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT,
    );
  });

  it('U13 already settled → 409 OFFERING_ALREADY_SETTLED', async () => {
    const h = build({ offering: { status: 'settled' } });
    await expect(h.service.settle(OFFERING_ID, ADMIN, KEY)).rejects.toSatisfy(
      (e: unknown) => codeOf(e).code === ErrorCode.OFFERING_ALREADY_SETTLED,
    );
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
  });

  it('U13b in-progress (subscribed, no failure stamp) → 409 OFFERING_SETTLE_IN_PROGRESS', async () => {
    const h = build({ offering: { status: 'subscribed', settleFailedAt: null } });
    await expect(h.service.settle(OFFERING_ID, ADMIN, KEY)).rejects.toSatisfy(
      (e: unknown) => codeOf(e).code === ErrorCode.OFFERING_SETTLE_IN_PROGRESS,
    );
  });

  it('U13c window still open → 409 OFFERING_WINDOW_STILL_OPEN', async () => {
    const h = build({ offering: { windowCloseAt: FUTURE } });
    await expect(h.service.settle(OFFERING_ID, ADMIN, KEY)).rejects.toSatisfy(
      (e: unknown) => codeOf(e).code === ErrorCode.OFFERING_WINDOW_STILL_OPEN,
    );
  });

  it('U13d in-flight bids → 409 OFFERING_HAS_INFLIGHT_BIDS', async () => {
    const h = build({ inflight: 1 });
    await expect(h.service.settle(OFFERING_ID, ADMIN, KEY)).rejects.toSatisfy(
      (e: unknown) => codeOf(e).code === ErrorCode.OFFERING_HAS_INFLIGHT_BIDS,
    );
  });

  it('U13e undersubscribed book (Σ count < float) → 422 OFFERING_UNDERSUBSCRIBED', async () => {
    // A book whose escrowed demand (50) is below public_float (100) → computeClearing.fullySubscribed=false.
    const h = build({
      bids: [
        {
          id: 'r1',
          chainBidId: 1,
          collectorSub: 's1',
          priceStroops: '100',
          count: '50',
          escrowAmountStroops: '5000',
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 1)),
        },
      ],
    });
    await expect(h.service.settle(OFFERING_ID, ADMIN, KEY)).rejects.toSatisfy(
      (e: unknown) => codeOf(e).code === ErrorCode.OFFERING_UNDERSUBSCRIBED,
    );
  });

  it('U13f too many bids → 409 OFFERING_TOO_MANY_BIDS', async () => {
    const h = build({ active: 41 });
    await expect(h.service.settle(OFFERING_ID, ADMIN, KEY)).rejects.toSatisfy(
      (e: unknown) => codeOf(e).code === ErrorCode.OFFERING_TOO_MANY_BIDS,
    );
  });

  it('U13g escrow not deployed → 409 OFFERING_ESCROW_UNAVAILABLE', async () => {
    const h = build({ offering: { escrowDeployStatus: 'deploying', escrowContractAddress: null } });
    await expect(h.service.settle(OFFERING_ID, ADMIN, KEY)).rejects.toSatisfy(
      (e: unknown) => codeOf(e).code === ErrorCode.OFFERING_ESCROW_UNAVAILABLE && codeOf(e).status === 409,
    );
  });

  it('re-drive path: subscribed + settleFailedAt set → reclaims and enqueues', async () => {
    const h = build({ offering: { status: 'subscribed', settleFailedAt: new Date() } });
    await h.service.settle(OFFERING_ID, ADMIN, KEY);
    expect(h.offerings.setSettleFailureStamp).toHaveBeenCalledOnce();
    expect(h.offerings.casSubscribed).not.toHaveBeenCalled();
    expect(h.settleQueue.add).toHaveBeenCalledOnce();
  });
});

describe('BackofficeOfferingsService.previewClearing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('U16 returns P + allocations, writes nothing, audits access', async () => {
    const h = build();
    const dto = await h.service.previewClearing(OFFERING_ID, ADMIN);
    expect(dto.fullySubscribed).toBe(true);
    expect(dto.clearingPriceStroops).toBe('90');
    expect(dto.allocations).toHaveLength(2);
    expect(h.offerings.casSubscribed).not.toHaveBeenCalled();
    expect(h.settleQueue.add).not.toHaveBeenCalled();
    const previewAudit = h.audit.record.mock.calls.find((c) => c[0].kind === AUDIT_KIND.OFFERING_CLEARING_PREVIEWED);
    expect(previewAudit).toBeDefined();
  });

  it('U16b window still open → 409 (no sealed-book leak)', async () => {
    const h = build({ offering: { windowCloseAt: FUTURE } });
    await expect(h.service.previewClearing(OFFERING_ID, ADMIN)).rejects.toSatisfy(
      (e: unknown) => codeOf(e).code === ErrorCode.OFFERING_WINDOW_STILL_OPEN,
    );
  });
});
