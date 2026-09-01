import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { BackofficeArtworksService } from '../../../../src/modules/backoffice/artworks/backoffice-artworks.service';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';

const ADMIN = '00000000-0000-4000-8000-00000000ad01';
const ARTWORK = '00000000-0000-4000-8000-0000000a0001';
const KEY = 'idem-key-1';
const DTO = {
  total_supply: 1_000_000,
  artist_retention_pct: 10,
  treasury_retention_pct: 5,
  artist_lockup_days: 365,
  treasury_lockup_days: 730,
  name: 'Northern Lights',
  symbol: 'NLIGHT',
};

/** errorCode carried on the object-form HttpException body (failHttp). */
const errorCodeOf = (err: unknown): string | undefined =>
  err instanceof HttpException ? (err.getResponse() as { errorCode?: string }).errorCode : undefined;

function build(overrides: {
  artwork?: { status: string; artistUserId: string } | null;
  walletAddress?: string | null;
  begin?: unknown;
  casStatus?: boolean;
}) {
  const contractRepo = { create: (x: unknown) => x, save: vi.fn((r: object) => Promise.resolve({ ...r, id: 'fc1' })) };
  const manager = { getRepository: vi.fn(() => contractRepo) };

  const artworks = {
    findOneById: vi.fn(() => Promise.resolve(overrides.artwork ?? null)),
    casStatus: vi.fn(() => Promise.resolve(overrides.casStatus ?? true)),
    runInTransaction: vi.fn((cb: (m: unknown) => Promise<unknown>) => cb(manager)),
  };
  const contracts = { findActiveByArtworkId: vi.fn(() => Promise.resolve(null)) };
  const wallets = { resolvePrimarySettlementAddress: vi.fn(() => Promise.resolve(overrides.walletAddress ?? null)) };
  const cfg = { maxTotalSupply: 1_000_000, maxLockupDays: 3650, tokenWasmHash: 'ab'.repeat(32) };
  const idempotency = {
    begin: vi.fn(() => Promise.resolve(overrides.begin ?? { outcome: 'proceed', token: 't1' })),
    complete: vi.fn(() => Promise.resolve(undefined)),
    fail: vi.fn(() => Promise.resolve(undefined)),
  };
  const audit = { record: vi.fn(() => Promise.resolve(undefined)) };
  const deployQueue = { add: vi.fn(() => Promise.resolve(undefined)) };

  const service = new BackofficeArtworksService(
    artworks as never,
    contracts as never,
    wallets as never,
    cfg as never,
    idempotency as never,
    audit as never,
    deployQueue as never,
  );
  return { service, artworks, contracts, wallets, idempotency, audit, deployQueue, contractRepo };
}

const run = (h: ReturnType<typeof build>) => h.service.fractionalize(ARTWORK, DTO, ADMIN, KEY);

describe('BackofficeArtworksService.fractionalize', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deploys a verified artwork: 202 deploying, CAS + insert + audit + enqueue + complete', async () => {
    const h = build({ artwork: { status: 'verified', artistUserId: 'u1' }, walletAddress: 'C1' });
    const res = await run(h);

    expect(res.status).toBe('deploying');
    expect(res.fractionContractId).toBe('fc1');
    expect(h.artworks.casStatus).toHaveBeenCalledWith(expect.anything(), ARTWORK, 'verified', 'fractionalizing');
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'admin', actorId: ADMIN, kind: 'artwork.fractionalization.requested' }),
      expect.anything(),
    );
    expect(h.deployQueue.add).toHaveBeenCalledWith('deploy', { fractionContractId: 'fc1' }, expect.objectContaining({ jobId: 'fc1' }));
    expect(h.idempotency.complete).toHaveBeenCalledOnce();
    expect(h.idempotency.fail).not.toHaveBeenCalled();
  });

  it('idempotency begins BEFORE the state guard (replay returns the stored 202, no artwork read)', async () => {
    const stored = { artworkId: ARTWORK, fractionContractId: 'fc1', status: 'deploying', tokenAddress: null };
    const h = build({ begin: { outcome: 'replay', body: stored } });
    await expect(run(h)).resolves.toEqual(stored);
    expect(h.artworks.findOneById).not.toHaveBeenCalled();
  });

  it('maps idempotency in_flight → 409, mismatch → 422 (422 body)', async () => {
    const inflight = build({ begin: { outcome: 'in_flight' } });
    await expect(run(inflight)).rejects.toMatchObject({ status: 409 });

    const mismatch = build({ begin: { outcome: 'mismatch' } });
    await run(mismatch).catch((e) => expect(errorCodeOf(e)).toBe(ErrorCode.IDEMPOTENCY_KEY_MISMATCH));
  });

  it('rejects total_supply over the configured max with 422 BEFORE idempotency begin', async () => {
    const h = build({});
    const overMax = { ...DTO, total_supply: 2_000_000 };
    await h.service
      .fractionalize(ARTWORK, overMax as never, ADMIN, KEY)
      .catch((e) => expect((e as HttpException).getStatus()).toBe(422));
    expect(h.idempotency.begin).not.toHaveBeenCalled();
  });

  it('404 when the artwork does not exist (and releases the key)', async () => {
    const h = build({ artwork: null });
    await run(h).catch((e) => expect(errorCodeOf(e)).toBe(ErrorCode.ARTWORK_NOT_FOUND));
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
  });

  it.each([
    ['fractionalized', ErrorCode.ARTWORK_ALREADY_FRACTIONALIZED],
    ['fractionalizing', ErrorCode.ARTWORK_FRACTIONALIZATION_IN_PROGRESS],
    ['published', ErrorCode.ARTWORK_NOT_FRACTIONALIZABLE],
  ])('409 %s → %s, no enqueue', async (status, code) => {
    const h = build({ artwork: { status, artistUserId: 'u1' } });
    await run(h).catch((e) => {
      expect((e as HttpException).getStatus()).toBe(409);
      expect(errorCodeOf(e)).toBe(code);
    });
    expect(h.deployQueue.add).not.toHaveBeenCalled();
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
  });

  it('422 when the artist has no primary settlement wallet', async () => {
    const h = build({ artwork: { status: 'verified', artistUserId: 'u1' } });
    await run(h).catch((e) => {
      expect((e as HttpException).getStatus()).toBe(422);
      expect(errorCodeOf(e)).toBe(ErrorCode.ARTIST_NO_PRIMARY_WALLET);
    });
  });

  it('409 when the CAS loses the race (concurrent request already moved the artwork)', async () => {
    const h = build({ artwork: { status: 'verified', artistUserId: 'u1' }, walletAddress: 'C1', casStatus: false });
    await run(h).catch((e) => {
      expect((e as HttpException).getStatus()).toBe(409);
      expect(errorCodeOf(e)).toBe(ErrorCode.ARTWORK_FRACTIONALIZATION_IN_PROGRESS);
    });
    expect(h.deployQueue.add).not.toHaveBeenCalled();
    expect(h.idempotency.fail).toHaveBeenCalledOnce();
  });
});
