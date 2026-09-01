import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { QuotesService } from '../../../../src/modules/marketplace/quotes/quotes.service';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { EmbeddedWalletNotFoundError } from '../../../../src/modules/wallets/embedded-wallet-not-found.error';

const USER = '00000000-0000-4000-8000-00000000d001';
const BUYER = '00000000-0000-4000-8000-00000000d999';
const RFQ = '00000000-0000-4000-8000-0000000b0001';
const TOKEN = 'CTOKEN000000000000000000000000000000000000000000000000000';
const KEY = 'idem-key-q1';

// validUntil BEFORE the RFQ expiry (not capped) by default.
const VALID_UNTIL = '2027-01-01T00:00:00Z';
const RFQ_EXPIRES = new Date('2027-06-01T00:00:00Z');

const DTO = {
  pricePerFractionStroops: '150000000',
  fractionCount: 25,
  validUntil: VALID_UNTIL,
};

const errorCodeOf = (err: unknown): string | undefined =>
  err instanceof HttpException ? (err.getResponse() as { errorCode?: string }).errorCode : undefined;
const statusOf = (err: unknown): number | undefined =>
  err instanceof HttpException ? err.getStatus() : undefined;
const bodyOf = (err: unknown): Record<string, unknown> =>
  err instanceof HttpException ? (err.getResponse() as Record<string, unknown>) : {};

interface Overrides {
  begin?: unknown;
  user?: { kycStatus: string } | null;
  rfq?: object | null;
  contract?: object | null;
  wallet?: string | null;
  onchain?: string;
  balancesReject?: Error;
  locked?: bigint;
  hasOpen?: boolean;
  insertOpen?: object | null;
  existing?: object | null;
}

function build(overrides: Overrides = {}) {
  const savedRow = {
    id: 'q1',
    rfqId: RFQ,
    holderSub: USER,
    fractionContractId: 'fc1',
    fractionCount: '25',
    pricePerFractionStroops: '150000000',
    validUntil: new Date(VALID_UNTIL),
    status: 'open',
    createdAt: new Date('2026-08-22T12:00:00Z'),
  };
  const defaultRfq = {
    id: RFQ,
    collectorSub: BUYER,
    fractionContractId: 'fc1',
    status: 'open',
    expiresAt: RFQ_EXPIRES,
    createdAt: new Date('2026-08-20T12:00:00Z'),
  };
  const quotes = {
    runInTransaction: vi.fn((cb: (m: unknown) => Promise<unknown>) => cb({ query: vi.fn(() => Promise.resolve()) })),
    reapLapsed: vi.fn(() => Promise.resolve(0)),
    hasOpenQuoteForRfq: vi.fn(() => Promise.resolve(overrides.hasOpen ?? false)),
    sumOpenLockedCount: vi.fn(() => Promise.resolve(overrides.locked ?? 0n)),
    insertOpen: vi.fn(() => Promise.resolve('insertOpen' in overrides ? overrides.insertOpen : savedRow)),
    findByIdempotency: vi.fn(() => Promise.resolve('existing' in overrides ? overrides.existing : null)),
  };
  const rfqs = {
    findOneById: vi.fn(() => Promise.resolve('rfq' in overrides ? overrides.rfq : defaultRfq)),
  };
  const users = {
    findKycStatusByUserId: vi.fn(() =>
      Promise.resolve('user' in overrides ? overrides.user : { kycStatus: 'whitelisted' }),
    ),
  };
  const contracts = {
    findOneById: vi.fn(() =>
      Promise.resolve('contract' in overrides ? overrides.contract : { id: 'fc1', status: 'deployed', tokenAddress: TOKEN }),
    ),
  };
  const fractionRead = {
    balancesOf: vi.fn(() =>
      overrides.balancesReject
        ? Promise.reject(overrides.balancesReject)
        : Promise.resolve(new Map([[TOKEN, overrides.onchain ?? '1000']])),
    ),
  };
  const walletsService = {
    resolveEmbeddedWalletForUser: vi.fn(() =>
      overrides.wallet === null
        ? Promise.reject(new EmbeddedWalletNotFoundError(USER))
        : Promise.resolve({ contractAddress: overrides.wallet ?? 'CWALLET', credential: {} }),
    ),
  };
  const idempotency = {
    begin: vi.fn(() => Promise.resolve(overrides.begin ?? { outcome: 'proceed', token: 't1' })),
    complete: vi.fn(() => Promise.resolve(undefined)),
    fail: vi.fn(() => Promise.resolve(undefined)),
  };
  const audit = { record: vi.fn(() => Promise.resolve(undefined)) };

  const service = new QuotesService(
    quotes as never,
    rfqs as never,
    users as never,
    contracts as never,
    fractionRead,
    walletsService as never,
    idempotency as never,
    audit as never,
  );
  return { service, quotes, rfqs, users, contracts, fractionRead, walletsService, idempotency, audit };
}

const run = (h: ReturnType<typeof build>, dto: object = DTO) => h.service.submit(USER, RFQ, dto as never, KEY);

/** Assert a submit REJECTS (guards against a false green if `submit` ever resolves) and run assertions on it. */
async function rejects(p: Promise<unknown>, assert: (e: unknown) => void): Promise<void> {
  let resolved = false;
  let err: unknown;
  try { await p; resolved = true; } catch (e) { err = e; }
  expect(resolved, 'expected the submit to reject').toBe(false);
  assert(err);
}

describe('QuotesService.submit', () => {
  beforeEach(() => vi.clearAllMocks());

  // --- happy path ---------------------------------------------------------
  it('creates an "open" quote: insert + audit + complete, fail not called, not capped', async () => {
    const h = build();
    const res = await run(h);

    expect(res.status).toBe('open');
    expect(res.id).toBe('q1');
    expect(res.rfqId).toBe(RFQ);
    expect(res).not.toHaveProperty('holderSub'); // #376: never expose the caller's internal sub
    expect(res.validUntilCapped).toBeUndefined();

    expect(h.quotes.insertOpen).toHaveBeenCalledOnce();
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'user', actorId: USER, kind: 'quote.submitted', subjectType: 'rfq_quote', subjectId: 'q1' }),
      expect.anything(),
    );
    expect(h.idempotency.complete).toHaveBeenCalledOnce();
    expect(h.idempotency.fail).not.toHaveBeenCalled();
    // audit payload never leaks the buyer's collector_sub
    const payload = (h.audit.record.mock.calls[0] as [{ payload: Record<string, unknown> }])[0].payload;
    expect(payload).not.toHaveProperty('collectorSub');
    expect(JSON.stringify(payload)).not.toContain(BUYER);
  });

  it('reaps lapsed quotes then re-checks the slot under the advisory lock before insert', async () => {
    const h = build();
    await run(h);
    expect(h.quotes.reapLapsed).toHaveBeenCalledOnce();
    // hasOpenQuoteForRfq is called twice: cheap pre-check (no manager) + authoritative under lock (manager).
    expect(h.quotes.hasOpenQuoteForRfq).toHaveBeenCalledTimes(2);
    expect(h.quotes.sumOpenLockedCount).toHaveBeenCalledOnce();
  });

  // --- free-balance gate --------------------------------------------------
  it('free < count → 422 QUOTE_INSUFFICIENT_FREE_BALANCE with requiredCount + freeBalance (strings)', async () => {
    const h = build({ onchain: '5' });
    await rejects(run(h, { ...DTO, fractionCount: 10 }), (e) => {
      expect(statusOf(e)).toBe(422);
      expect(errorCodeOf(e)).toBe(ErrorCode.QUOTE_INSUFFICIENT_FREE_BALANCE);
      expect(bodyOf(e).requiredCount).toBe('10');
      expect(bodyOf(e).freeBalance).toBe('5');
    });
    expect(h.quotes.insertOpen).not.toHaveBeenCalled();
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
  });

  it('locked from another open quote reduces free balance (onchain 10 − locked 6 = 4 < 5)', async () => {
    const h = build({ onchain: '10', locked: 6n });
    await rejects(run(h, { ...DTO, fractionCount: 5 }), (e) => {
      expect(errorCodeOf(e)).toBe(ErrorCode.QUOTE_INSUFFICIENT_FREE_BALANCE);
      expect(bodyOf(e).freeBalance).toBe('4');
    });
  });

  it('negative free (locked exceeds onchain) is clamped to 0 in the body', async () => {
    const h = build({ onchain: '3', locked: 10n });
    await rejects(run(h, { ...DTO, fractionCount: 1 }), (e) => {
      expect(bodyOf(e).freeBalance).toBe('0');
    });
  });

  it('chain read failure → 503 QUOTE_BALANCE_UNAVAILABLE, no insert (fail-closed)', async () => {
    const h = build({ balancesReject: new Error('rpc down') });
    await rejects(run(h), (e) => {
      expect(statusOf(e)).toBe(503);
      expect(errorCodeOf(e)).toBe(ErrorCode.QUOTE_BALANCE_UNAVAILABLE);
    });
    expect(h.quotes.insertOpen).not.toHaveBeenCalled();
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
  });

  it('no primary settlement wallet → 422 QUOTE_NO_SETTLEMENT_WALLET (distinct from insufficient balance)', async () => {
    const h = build({ wallet: null });
    await rejects(run(h), (e) => {
      expect(statusOf(e)).toBe(422);
      expect(errorCodeOf(e)).toBe(ErrorCode.QUOTE_NO_SETTLEMENT_WALLET);
    });
    expect(h.fractionRead.balancesOf).not.toHaveBeenCalled();
  });

  // --- validity capping ---------------------------------------------------
  it('validUntil after the RFQ expiry → capped + validUntilCapped:true', async () => {
    const h = build();
    const res = await run(h, { ...DTO, validUntil: '2027-12-31T00:00:00Z' }); // after RFQ_EXPIRES
    expect(res.validUntilCapped).toBe(true);
    const inserted = (h.quotes.insertOpen.mock.calls[0] as [unknown, { validUntil: Date }])[1].validUntil;
    expect(inserted.getTime()).toBe(RFQ_EXPIRES.getTime());
  });

  it('validUntil in the past → 422 QUOTE_INVALID_VALIDITY', async () => {
    const h = build();
    await rejects(run(h, { ...DTO, validUntil: '2020-01-01T00:00:00Z' }), (e) => {
      expect(errorCodeOf(e)).toBe(ErrorCode.QUOTE_INVALID_VALIDITY);
    });
  });

  // --- cheap state gates --------------------------------------------------
  it.each([
    ['not whitelisted', { user: { kycStatus: 'pending_review' } }, 403, ErrorCode.QUOTE_NOT_WHITELISTED, DTO],
    ['no user row', { user: null }, 403, ErrorCode.QUOTE_NOT_WHITELISTED, DTO],
    ['rfq missing', { rfq: null }, 404, ErrorCode.QUOTE_RFQ_NOT_FOUND, DTO],
    ['rfq not open', { rfq: { id: RFQ, collectorSub: BUYER, fractionContractId: 'fc1', status: 'filled', expiresAt: RFQ_EXPIRES } }, 422, ErrorCode.QUOTE_RFQ_NOT_OPEN, DTO],
    ['rfq expired', { rfq: { id: RFQ, collectorSub: BUYER, fractionContractId: 'fc1', status: 'open', expiresAt: new Date('2020-01-01T00:00:00Z') } }, 422, ErrorCode.QUOTE_RFQ_EXPIRED, DTO],
    ['self quote', { rfq: { id: RFQ, collectorSub: USER, fractionContractId: 'fc1', status: 'open', expiresAt: RFQ_EXPIRES } }, 422, ErrorCode.QUOTE_ON_OWN_RFQ, DTO],
    ['contract not deployed', { contract: { id: 'fc1', status: 'deploying', tokenAddress: null } }, 422, ErrorCode.QUOTE_RFQ_NOT_OPEN, DTO],
    ['already open (pre-check)', { hasOpen: true }, 409, ErrorCode.QUOTE_ALREADY_OPEN, DTO],
  ])('%s → %d %s (releases the key)', async (_label, ov, status, code, dto) => {
    const h = build(ov);
    await rejects(run(h, dto), (e) => {
      expect(statusOf(e)).toBe(status);
      expect(errorCodeOf(e)).toBe(code);
    });
    expect(h.idempotency.begin).toHaveBeenCalledOnce();
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
    expect(h.idempotency.complete).not.toHaveBeenCalled();
  });

  it.each([
    ['zero price', '0'],
    ['price above 2^96-1', '79228162514264337593543950336'],
  ])('%s → 422 QUOTE_INVALID_PRICE', async (_label, price) => {
    const h = build();
    await rejects(run(h, { ...DTO, pricePerFractionStroops: price }), (e) => {
      expect(errorCodeOf(e)).toBe(ErrorCode.QUOTE_INVALID_PRICE);
    });
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
  });

  it('price × count over the i128 ceiling → 422 QUOTE_AMOUNT_OVERFLOW', async () => {
    const h = build();
    await rejects(run(h, { ...DTO, pricePerFractionStroops: '79228162514264337593543950335', fractionCount: 9_000_000_000_000 }), (e) => {
      expect(errorCodeOf(e)).toBe(ErrorCode.QUOTE_AMOUNT_OVERFLOW);
    });
  });

  // --- idempotency outcomes ----------------------------------------------
  it('replay → returns the stored body, no whitelist/rfq read', async () => {
    const stored = { id: 'q1', status: 'open' };
    const h = build({ begin: { outcome: 'replay', body: stored } });
    await expect(run(h)).resolves.toEqual(stored);
    expect(h.users.findKycStatusByUserId).not.toHaveBeenCalled();
    expect(h.rfqs.findOneById).not.toHaveBeenCalled();
  });

  it('in_flight → 409, fail not called', async () => {
    const h = build({ begin: { outcome: 'in_flight' } });
    await rejects(run(h), (e) => {
      expect(statusOf(e)).toBe(409);
      expect(errorCodeOf(e)).toBe(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT);
    });
    expect(h.idempotency.fail).not.toHaveBeenCalled();
  });

  it('mismatch → 422, fail not called', async () => {
    const h = build({ begin: { outcome: 'mismatch' } });
    await rejects(run(h), (e) => {
      expect(errorCodeOf(e)).toBe(ErrorCode.IDEMPOTENCY_KEY_MISMATCH);
    });
    expect(h.idempotency.fail).not.toHaveBeenCalled();
  });

  // --- durable-backstop replay -------------------------------------------
  it('insert conflict → replays the existing row (complete, no audit, no fail, no capped flag)', async () => {
    const existing = { id: 'q-existing', rfqId: RFQ, holderSub: USER, fractionContractId: 'fc1', fractionCount: '25', pricePerFractionStroops: '150000000', validUntil: new Date(VALID_UNTIL), status: 'open', createdAt: new Date('2026-08-22T12:00:00Z') };
    const h = build({ insertOpen: null, existing });
    const res = await run(h);
    expect(res.id).toBe('q-existing');
    expect(res.validUntilCapped).toBeUndefined();
    expect(h.audit.record).not.toHaveBeenCalled();
    expect(h.idempotency.complete).toHaveBeenCalledOnce();
    expect(h.idempotency.fail).not.toHaveBeenCalled();
  });

  it('insert conflict but no visible row → 409 (releases the key)', async () => {
    const h = build({ insertOpen: null, existing: null });
    await rejects(run(h), (e) => {
      expect(statusOf(e)).toBe(409);
      expect(errorCodeOf(e)).toBe(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT);
    });
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
  });

  // --- fingerprint canonicalization --------------------------------------
  it('the same instant in two ISO formats hashes identically; a different instant differs', async () => {
    const fpOf = async (validUntil: string): Promise<string> => {
      const h = build();
      await run(h, { ...DTO, validUntil });
      return (h.idempotency.begin.mock.calls[0] as [string, string])[1];
    };
    expect(await fpOf('2027-01-01T00:00:00Z')).toBe(await fpOf('2027-01-01T00:00:00.000+00:00'));
    expect(await fpOf('2027-01-01T00:00:00Z')).not.toBe(await fpOf('2027-02-01T00:00:00Z'));
  });
});
