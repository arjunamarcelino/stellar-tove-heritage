import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { RfqsService } from '../../../../src/modules/marketplace/rfqs/rfqs.service';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';

const USER = '00000000-0000-4000-8000-00000000c001';
const ARTWORK = '00000000-0000-4000-8000-0000000a0001';
const KEY = 'idem-key-1';

const DTO = {
  artworkId: ARTWORK,
  fractionCount: 100,
  maxPricePerFractionStroops: '150000000',
  expiryHours: 72,
};

const errorCodeOf = (err: unknown): string | undefined =>
  err instanceof HttpException ? (err.getResponse() as { errorCode?: string }).errorCode : undefined;
const statusOf = (err: unknown): number | undefined =>
  err instanceof HttpException ? err.getStatus() : undefined;

interface Overrides {
  begin?: unknown;
  user?: { kycStatus: string } | null;
  activeOpen?: number;
  artwork?: object | null;
  contract?: object | null;
  warning?: { requiredStroops: string; availableStroops: string };
  insertOpen?: object | null;
  existing?: object | null;
}

function build(overrides: Overrides = {}) {
  const savedRow = {
    id: 'rfq1',
    collectorSub: USER,
    artworkId: ARTWORK,
    fractionContractId: 'fc1',
    fractionCount: '100',
    maxPricePerFractionStroops: '150000000',
    status: 'open',
    expiresAt: new Date('2026-08-24T12:00:00Z'),
    createdAt: new Date('2026-08-21T12:00:00Z'),
  };
  const rfqs = {
    runInTransaction: vi.fn((cb: (m: unknown) => Promise<unknown>) => cb({})),
    insertOpen: vi.fn(() => Promise.resolve('insertOpen' in overrides ? overrides.insertOpen : savedRow)),
    countActiveOpenByCollector: vi.fn(() => Promise.resolve(overrides.activeOpen ?? 0)),
    findOne: vi.fn(() => Promise.resolve('existing' in overrides ? overrides.existing : null)),
  };
  const users = {
    findKycStatusByUserId: vi.fn(() =>
      Promise.resolve('user' in overrides ? overrides.user : { kycStatus: 'whitelisted' }),
    ),
  };
  const artworks = {
    findOneById: vi.fn(() => Promise.resolve('artwork' in overrides ? overrides.artwork : { id: ARTWORK })),
  };
  const contracts = {
    findActiveByArtworkId: vi.fn(() =>
      Promise.resolve('contract' in overrides ? overrides.contract : { id: 'fc1', status: 'deployed' }),
    ),
  };
  const idempotency = {
    begin: vi.fn(() => Promise.resolve(overrides.begin ?? { outcome: 'proceed', token: 't1' })),
    complete: vi.fn(() => Promise.resolve(undefined)),
    fail: vi.fn(() => Promise.resolve(undefined)),
  };
  const audit = { record: vi.fn(() => Promise.resolve(undefined)) };
  const balanceAdvisor = { warnIfInsufficient: vi.fn(() => Promise.resolve(overrides.warning)) };
  const fanoutQueue = { add: vi.fn(() => Promise.resolve(undefined)) };

  const service = new RfqsService(
    rfqs as never,
    users as never,
    artworks as never,
    contracts as never,
    idempotency as never,
    audit as never,
    balanceAdvisor as never,
    fanoutQueue as never,
  );
  return { service, rfqs, users, artworks, contracts, idempotency, audit, balanceAdvisor, fanoutQueue, savedRow };
}

const run = (h: ReturnType<typeof build>, dto: object = DTO) => h.service.create(USER, dto as never, KEY);

describe('RfqsService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  // --- happy path ---------------------------------------------------------
  it('creates an "open" RFQ: insert + audit + complete called, fail not called, no warning by default', async () => {
    const h = build();
    const res = await run(h);

    expect(res.status).toBe('open');
    expect(res.id).toBe('rfq1');
    expect(res.artworkId).toBe(ARTWORK);
    expect(res.fractionContractId).toBe('fc1');
    expect(res.balanceWarning).toBeUndefined();

    expect(h.rfqs.insertOpen).toHaveBeenCalledOnce();
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'user', actorId: USER, kind: 'rfq.created', subjectType: 'rfq', subjectId: 'rfq1' }),
      expect.anything(),
    );
    expect(h.idempotency.complete).toHaveBeenCalledOnce();
    expect(h.idempotency.fail).not.toHaveBeenCalled();
  });

  // --- TOV-174 producer hook ---------------------------------------------
  it('enqueues the fan-out job on a genuinely-new RFQ (jobId = rfq id)', async () => {
    const h = build();
    await run(h);
    expect(h.fanoutQueue.add).toHaveBeenCalledTimes(1);
    expect(h.fanoutQueue.add).toHaveBeenCalledWith(
      'fanout',
      { rfqId: 'rfq1' },
      expect.objectContaining({ jobId: 'rfq1', attempts: 5 }),
    );
  });

  it('does NOT enqueue on the durable-backstop replay branch (insert conflict → existing row)', async () => {
    const existing = { id: 'rfq1', collectorSub: USER, artworkId: ARTWORK, fractionContractId: 'fc1', fractionCount: '100', maxPricePerFractionStroops: '150000000', status: 'open', expiresAt: new Date('2026-08-24T12:00:00Z'), createdAt: new Date('2026-08-21T12:00:00Z') };
    const h = build({ insertOpen: null, existing });
    await run(h);
    expect(h.fanoutQueue.add).not.toHaveBeenCalled();
  });

  it('a lost fan-out enqueue never fails the committed 201 (best-effort)', async () => {
    const h = build();
    h.fanoutQueue.add.mockRejectedValueOnce(new Error('redis down'));
    const res = await run(h);
    expect(res.id).toBe('rfq1'); // still returns the created RFQ
    expect(h.idempotency.complete).toHaveBeenCalledOnce();
  });

  it.each([
    ['default (omitted → 48h)', undefined, 48],
    ['explicit 1h', 1, 1],
    ['explicit 168h', 168, 168],
  ])('computes expires_at from expiryHours: %s', async (_label, expiryHours, effective) => {
    const h = build();
    const dto = { ...DTO, expiryHours };
    if (expiryHours === undefined) delete (dto as { expiryHours?: number }).expiryHours;
    const before = Date.now();
    await run(h, dto);
    const passed = (h.rfqs.insertOpen.mock.calls[0] as [unknown, { expiresAt: Date }])[1].expiresAt;
    const expected = before + effective * 3_600_000;
    // within a few seconds of now + effective hours
    expect(Math.abs(passed.getTime() - expected)).toBeLessThan(5_000);
  });

  it('passes the advisor warning through into the 201 body', async () => {
    const warning = { requiredStroops: '15000000000', availableStroops: '100' };
    const h = build({ warning });
    const res = await run(h);
    expect(res.balanceWarning).toEqual(warning);
  });

  // --- idempotency outcomes ----------------------------------------------
  it('replay → returns the stored body, no whitelist/artwork read', async () => {
    const stored = { id: 'rfq1', status: 'open' };
    const h = build({ begin: { outcome: 'replay', body: stored } });
    await expect(run(h)).resolves.toEqual(stored);
    expect(h.users.findKycStatusByUserId).not.toHaveBeenCalled();
    expect(h.artworks.findOneById).not.toHaveBeenCalled();
  });

  it('in_flight → 409 IDEMPOTENCY_KEY_IN_FLIGHT, fail not called', async () => {
    const h = build({ begin: { outcome: 'in_flight' } });
    await run(h).catch((e) => {
      expect(statusOf(e)).toBe(409);
      expect(errorCodeOf(e)).toBe(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT);
    });
    expect(h.idempotency.fail).not.toHaveBeenCalled();
  });

  it('mismatch → 422 IDEMPOTENCY_KEY_MISMATCH, fail not called', async () => {
    const h = build({ begin: { outcome: 'mismatch' } });
    await run(h).catch((e) => {
      expect(statusOf(e)).toBe(422);
      expect(errorCodeOf(e)).toBe(ErrorCode.IDEMPOTENCY_KEY_MISMATCH);
    });
    expect(h.idempotency.fail).not.toHaveBeenCalled();
  });

  // --- state-derived rejections (all AFTER begin → idempotency.fail) ------
  it.each([
    ['not whitelisted', { user: { kycStatus: 'pending_review' } }, 403, ErrorCode.RFQ_NOT_WHITELISTED],
    ['no user row', { user: null }, 403, ErrorCode.RFQ_NOT_WHITELISTED],
    ['at active-open ceiling', { activeOpen: 25 }, 422, ErrorCode.RFQ_TOO_MANY_ACTIVE],
    ['zero price', {}, 422, ErrorCode.RFQ_INVALID_PRICE],
    ['artwork missing', { artwork: null }, 404, ErrorCode.ARTWORK_NOT_FOUND],
    ['no active contract', { contract: null }, 422, ErrorCode.RFQ_ARTWORK_NOT_FRACTIONALIZED],
    ['contract not deployed', { contract: { id: 'fc1', status: 'deploying' } }, 422, ErrorCode.RFQ_ARTWORK_NOT_FRACTIONALIZED],
  ])('%s → %d %s (releases the key)', async (_label, ov, status, code) => {
    const dto = code === ErrorCode.RFQ_INVALID_PRICE ? { ...DTO, maxPricePerFractionStroops: '0' } : DTO;
    const h = build(ov);
    await run(h, dto).catch((e) => {
      expect(statusOf(e)).toBe(status);
      expect(errorCodeOf(e)).toBe(code);
    });
    expect(h.idempotency.begin).toHaveBeenCalledOnce(); // begin ran BEFORE the state gate
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
    expect(h.idempotency.complete).not.toHaveBeenCalled();
  });

  it('price above 2^96-1 → 422 RFQ_INVALID_PRICE', async () => {
    const h = build();
    await run(h, { ...DTO, maxPricePerFractionStroops: '79228162514264337593543950336' }).catch((e) => {
      expect(statusOf(e)).toBe(422);
      expect(errorCodeOf(e)).toBe(ErrorCode.RFQ_INVALID_PRICE);
    });
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
  });

  it('price × count over the i128 ceiling → 422 RFQ_AMOUNT_OVERFLOW', async () => {
    // MAX_STROOPS (2^96-1) × a large count > MAX_I128 (2^127-1).
    const h = build();
    await run(h, {
      ...DTO,
      maxPricePerFractionStroops: '79228162514264337593543950335',
      fractionCount: 9_000_000_000_000,
    }).catch((e) => {
      expect(statusOf(e)).toBe(422);
      expect(errorCodeOf(e)).toBe(ErrorCode.RFQ_AMOUNT_OVERFLOW);
    });
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
  });

  // --- durable-backstop replay (insert conflict → orIgnore null) ----------
  it('insert conflict → replays the existing row (complete called, fail NOT called, no warning)', async () => {
    const existing = {
      id: 'rfq-existing',
      collectorSub: USER,
      artworkId: ARTWORK,
      fractionContractId: 'fc1',
      fractionCount: '100',
      maxPricePerFractionStroops: '150000000',
      status: 'open',
      expiresAt: new Date('2026-08-24T12:00:00Z'),
      createdAt: new Date('2026-08-21T12:00:00Z'),
    };
    const h = build({ insertOpen: null, existing, warning: { requiredStroops: '1', availableStroops: '0' } });
    const res = await run(h);
    expect(res.id).toBe('rfq-existing');
    expect(res.balanceWarning).toBeUndefined(); // backstop replay returns the persisted row, no ephemeral warning
    expect(h.audit.record).not.toHaveBeenCalled();
    expect(h.idempotency.complete).toHaveBeenCalledOnce();
    expect(h.idempotency.fail).not.toHaveBeenCalled();
  });

  it('insert conflict but no visible row → 409 IDEMPOTENCY_KEY_IN_FLIGHT (releases the key)', async () => {
    const h = build({ insertOpen: null, existing: null });
    await run(h).catch((e) => {
      expect(statusOf(e)).toBe(409);
      expect(errorCodeOf(e)).toBe(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT);
    });
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
  });

  // --- fingerprint canonicalization --------------------------------------
  describe('fingerprint canonicalizes the default expiry', () => {
    const fpOf = async (dto: object): Promise<string> => {
      const h = build();
      await run(h, dto);
      return (h.idempotency.begin.mock.calls[0] as [string, string])[1];
    };

    it('omitted expiryHours hashes identically to explicit 48', async () => {
      const omitted = { artworkId: ARTWORK, fractionCount: 100, maxPricePerFractionStroops: '150000000' };
      const explicit48 = { ...omitted, expiryHours: 48 };
      expect(await fpOf(explicit48)).toBe(await fpOf(omitted));
    });

    it('a different expiry hashes differently', async () => {
      const a = { artworkId: ARTWORK, fractionCount: 100, maxPricePerFractionStroops: '150000000', expiryHours: 48 };
      const b = { ...a, expiryHours: 72 };
      expect(await fpOf(b)).not.toBe(await fpOf(a));
    });
  });
});
