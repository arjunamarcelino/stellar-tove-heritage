import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { BackofficeOfferingsService } from '../../../../src/modules/backoffice/offerings/backoffice-offerings.service';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';

const ADMIN = '00000000-0000-4000-8000-00000000ad01';
const ARTWORK = '00000000-0000-4000-8000-0000000a0001';
const KEY = 'idem-key-1';

const DTO = {
  artwork_id: ARTWORK,
  low_price_stroops: '50000000',
  high_price_stroops: '150000000',
  window_open_at: '2026-09-01T00:00:00Z',
  window_close_at: '2026-09-08T00:00:00Z',
};

/** A `deployed` fraction_contract with retentions → public float = 1_000_000 - 100_000 - 50_000 = 850_000. */
const CONTRACT = {
  id: 'fc1',
  status: 'deployed',
  totalSupply: '1000000',
  artistRetentionAmount: '100000',
  treasuryRetentionAmount: '50000',
};

/** errorCode carried on the object-form HttpException body (failHttp). */
const errorCodeOf = (err: unknown): string | undefined =>
  err instanceof HttpException ? (err.getResponse() as { errorCode?: string }).errorCode : undefined;

function build(overrides: {
  artwork?: object | null;
  contract?: object | null;
  begin?: unknown;
  saveImpl?: (r: object) => Promise<unknown>;
} = {}) {
  const savedCreatedAt = new Date('2026-08-18T12:00:00Z');
  const defaultSave = (r: object) => Promise.resolve({ ...r, id: 'off1', createdAt: savedCreatedAt });
  const repoInTx = {
    create: (x: object) => x,
    save: vi.fn(overrides.saveImpl ?? defaultSave),
  };
  const manager = { getRepository: vi.fn(() => repoInTx) };

  const offerings = {
    runInTransaction: vi.fn((cb: (m: unknown) => Promise<unknown>) => cb(manager)),
  };
  const artworks = {
    findOneById: vi.fn(() => Promise.resolve('artwork' in overrides ? overrides.artwork : { id: ARTWORK })),
  };
  const contracts = {
    findActiveByArtworkId: vi.fn(() => Promise.resolve('contract' in overrides ? overrides.contract : CONTRACT)),
  };
  const idempotency = {
    begin: vi.fn(() => Promise.resolve(overrides.begin ?? { outcome: 'proceed', token: 't1' })),
    complete: vi.fn(() => Promise.resolve(undefined)),
    fail: vi.fn(() => Promise.resolve(undefined)),
  };
  const audit = { record: vi.fn(() => Promise.resolve(undefined)) };
  // TOV-154 additions (unused by the plan-offering `create` path these specs exercise).
  const approvals = {
    insertSignature: vi.fn(() => Promise.resolve(undefined)),
    countLiveSigners: vi.fn(() => Promise.resolve(0)),
    approvalSummariesFor: vi.fn(() => Promise.resolve(new Map())),
  };
  const escrowCfg = { signerSet: new Set<string>(), threshold: 2, maxBidsPerOffering: 40 };
  const deployQueue = { add: vi.fn(() => Promise.resolve(undefined)) };
  const settleQueue = { add: vi.fn(() => Promise.resolve(undefined)) };
  // TOV-160 additions (unused by the plan-offering `create` path these specs exercise).
  const bids = {
    listBidsForClearing: vi.fn(() => Promise.resolve([])),
    countInflight: vi.fn(() => Promise.resolve(0)),
    sumEscrowedCount: vi.fn(() => Promise.resolve('0')),
    countActiveForOffering: vi.fn(() => Promise.resolve(0)),
  };

  const service = new BackofficeOfferingsService(
    offerings as never,
    approvals as never,
    artworks as never,
    contracts as never,
    escrowCfg as never,
    deployQueue as never,
    idempotency as never,
    audit as never,
  );
  return { service, offerings, approvals, bids, artworks, contracts, escrowCfg, deployQueue, settleQueue, idempotency, audit, repoInTx, savedCreatedAt };
}

const run = (h: ReturnType<typeof build>, dto: object = DTO) =>
  h.service.create(dto as never, ADMIN, KEY);

describe('BackofficeOfferingsService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  // --- happy path ---------------------------------------------------------
  it('plans a "planned" offering: insert + audit + complete called, fail not called, publicFloat exact', async () => {
    const h = build();
    const res = await run(h);

    expect(res.status).toBe('planned');
    expect(res.id).toBe('off1');
    expect(res.artworkId).toBe(ARTWORK);
    expect(res.fractionContractId).toBe('fc1');
    expect(res.lowPriceStroops).toBe('50000000');
    expect(res.highPriceStroops).toBe('150000000');
    expect(res.publicFloat).toBe('850000');
    expect(res.windowOpenAt).toBe('2026-09-01T00:00:00.000Z');
    expect(res.windowCloseAt).toBe('2026-09-08T00:00:00.000Z');
    expect(res.createdAt).toBe(h.savedCreatedAt.toISOString());

    expect(h.repoInTx.save).toHaveBeenCalledOnce();
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'admin',
        actorId: ADMIN,
        kind: 'offering.planned',
        subjectType: 'offering',
        subjectId: 'off1',
      }),
      expect.anything(),
    );
    expect(h.idempotency.complete).toHaveBeenCalledOnce();
    expect(h.idempotency.fail).not.toHaveBeenCalled();
  });

  // --- public_float math --------------------------------------------------
  it('computes public_float = total - artist - treasury (exact BigInt string)', async () => {
    const h = build({
      contract: { id: 'fc2', status: 'deployed', totalSupply: '900000000', artistRetentionAmount: '1', treasuryRetentionAmount: '2' },
    });
    const res = await run(h);
    expect(res.publicFloat).toBe('899999997');
  });

  it('zero-retention contract → public_float equals the full supply', async () => {
    const h = build({
      contract: { id: 'fc3', status: 'deployed', totalSupply: '1000000', artistRetentionAmount: '0', treasuryRetentionAmount: '0' },
    });
    const res = await run(h);
    expect(res.publicFloat).toBe('1000000');
  });

  // --- band validation (before idempotency.begin) -------------------------
  it.each([
    ['low <= 0', { low_price_stroops: '0', high_price_stroops: '150000000' }],
    ['high <= 0 (low<high fails first? use low 0)', { low_price_stroops: '0', high_price_stroops: '0' }],
    ['low == high', { low_price_stroops: '100', high_price_stroops: '100' }],
    ['low > high', { low_price_stroops: '200', high_price_stroops: '100' }],
    ['high > 2^96-1', { low_price_stroops: '1', high_price_stroops: '79228162514264337593543950336' }],
  ])('422 OFFERING_BAND_INVALID (%s) BEFORE idempotency.begin', async (_label, patch) => {
    const h = build();
    await run(h, { ...DTO, ...patch }).catch((e) => {
      expect((e as HttpException).getStatus()).toBe(422);
      expect(errorCodeOf(e)).toBe(ErrorCode.OFFERING_BAND_INVALID);
    });
    expect(h.idempotency.begin).not.toHaveBeenCalled();
  });

  // --- window validation (before idempotency.begin) -----------------------
  it.each([
    ['open > close', { window_open_at: '2026-09-08T00:00:00Z', window_close_at: '2026-09-01T00:00:00Z' }],
    ['open == close', { window_open_at: '2026-09-01T00:00:00Z', window_close_at: '2026-09-01T00:00:00Z' }],
  ])('422 OFFERING_WINDOW_INVALID (%s) BEFORE idempotency.begin', async (_label, patch) => {
    const h = build();
    await run(h, { ...DTO, ...patch }).catch((e) => {
      expect((e as HttpException).getStatus()).toBe(422);
      expect(errorCodeOf(e)).toBe(ErrorCode.OFFERING_WINDOW_INVALID);
    });
    expect(h.idempotency.begin).not.toHaveBeenCalled();
  });

  // --- idempotency --------------------------------------------------------
  it('replay → returns the stored 201 body, no artwork/contract read', async () => {
    const stored = { id: 'off1', artworkId: ARTWORK, status: 'planned' };
    const h = build({ begin: { outcome: 'replay', body: stored } });
    await expect(run(h)).resolves.toEqual(stored);
    expect(h.artworks.findOneById).not.toHaveBeenCalled();
    expect(h.contracts.findActiveByArtworkId).not.toHaveBeenCalled();
  });

  it('in_flight → 409 IDEMPOTENCY_KEY_IN_FLIGHT', async () => {
    const h = build({ begin: { outcome: 'in_flight' } });
    await run(h).catch((e) => {
      expect((e as HttpException).getStatus()).toBe(409);
      expect(errorCodeOf(e)).toBe(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT);
    });
    expect(h.idempotency.fail).not.toHaveBeenCalled();
  });

  it('mismatch → 422 IDEMPOTENCY_KEY_MISMATCH', async () => {
    const h = build({ begin: { outcome: 'mismatch' } });
    await run(h).catch((e) => {
      expect((e as HttpException).getStatus()).toBe(422);
      expect(errorCodeOf(e)).toBe(ErrorCode.IDEMPOTENCY_KEY_MISMATCH);
    });
    expect(h.idempotency.fail).not.toHaveBeenCalled();
  });

  // --- state-derived rejections (all AFTER begin → idempotency.fail) ------
  it('404 ARTWORK_NOT_FOUND when the artwork is missing (releases the key)', async () => {
    const h = build({ artwork: null });
    await run(h).catch((e) => {
      expect((e as HttpException).getStatus()).toBe(404);
      expect(errorCodeOf(e)).toBe(ErrorCode.ARTWORK_NOT_FOUND);
    });
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
  });

  it.each([
    ['no active contract', null],
    ['contract not deployed', { id: 'fc1', status: 'deploying', artistRetentionAmount: '1', treasuryRetentionAmount: '1' }],
    ['artist retention null', { id: 'fc1', status: 'deployed', totalSupply: '1000000', artistRetentionAmount: null, treasuryRetentionAmount: '1' }],
    ['treasury retention null', { id: 'fc1', status: 'deployed', totalSupply: '1000000', artistRetentionAmount: '1', treasuryRetentionAmount: null }],
  ])('409 OFFERING_ARTWORK_NOT_FRACTIONALIZED (%s)', async (_label, contract) => {
    const h = build({ contract });
    await run(h).catch((e) => {
      expect((e as HttpException).getStatus()).toBe(409);
      expect(errorCodeOf(e)).toBe(ErrorCode.OFFERING_ARTWORK_NOT_FRACTIONALIZED);
    });
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
  });

  it.each([
    ['zero float', { id: 'fc1', status: 'deployed', totalSupply: '100000', artistRetentionAmount: '60000', treasuryRetentionAmount: '40000' }],
    ['negative float', { id: 'fc1', status: 'deployed', totalSupply: '100000', artistRetentionAmount: '60000', treasuryRetentionAmount: '50000' }],
  ])('422 OFFERING_NO_FLOAT (%s)', async (_label, contract) => {
    const h = build({ contract });
    await run(h).catch((e) => {
      expect((e as HttpException).getStatus()).toBe(422);
      expect(errorCodeOf(e)).toBe(ErrorCode.OFFERING_NO_FLOAT);
    });
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
  });

  // --- insert-time uniqueness race ----------------------------------------
  it('23505 on UQ_offerings_active_per_artwork → 409 OFFERING_ALREADY_ACTIVE (and releases the key)', async () => {
    const h = build({
      saveImpl: () =>
        Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'UQ_offerings_active_per_artwork' })),
    });
    await run(h).catch((e) => {
      expect((e as HttpException).getStatus()).toBe(409);
      expect(errorCodeOf(e)).toBe(ErrorCode.OFFERING_ALREADY_ACTIVE);
    });
    expect(h.audit.record).not.toHaveBeenCalled();
    expect(h.idempotency.complete).not.toHaveBeenCalled();
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
  });

  it('non-23505 insert error is rethrown unchanged (and releases the key)', async () => {
    const boom = Object.assign(new Error('connection failure'), { code: '08006' });
    const h = build({ saveImpl: () => Promise.reject(boom) });
    await expect(run(h)).rejects.toBe(boom);
    expect(h.idempotency.complete).not.toHaveBeenCalled();
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
  });

  // --- idempotency fingerprint canonicalization (todo 258) -----------------
  describe('fingerprint canonicalizes timestamps', () => {
    // The fingerprint is the 2nd arg passed to idempotency.begin.
    const fpOf = async (dto: object): Promise<string> => {
      const h = build();
      await run(h, dto);
      return (h.idempotency.begin.mock.calls[0] as [string, string])[1];
    };

    it('hashes timezone-equivalent windows identically (Z vs .000Z vs +00:00)', async () => {
      const zulu = await fpOf(DTO);
      const millis = await fpOf({
        ...DTO,
        window_open_at: '2026-09-01T00:00:00.000Z',
        window_close_at: '2026-09-08T00:00:00.000Z',
      });
      const offset = await fpOf({
        ...DTO,
        window_open_at: '2026-09-01T00:00:00+00:00',
        window_close_at: '2026-09-08T00:00:00+00:00',
      });
      expect(millis).toBe(zulu);
      expect(offset).toBe(zulu);
    });

    it('hashes a genuinely different instant differently', async () => {
      const a = await fpOf(DTO);
      const b = await fpOf({ ...DTO, window_close_at: '2026-09-09T00:00:00Z' });
      expect(b).not.toBe(a);
    });
  });
});
