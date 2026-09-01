import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { MeHoldingsService } from '../../../../src/modules/fractionalization/me/me-holdings.service';
import { FractionReadUnavailableError } from '../../../../src/modules/fractionalization/fraction-read.errors';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import type { FractionContract } from '../../../../src/modules/fractionalization/entities/fraction-contract.entity';
import type { Artwork } from '../../../../src/modules/fractionalization/entities/artwork.entity';

const WALLET = 'C'.repeat(56); // caller's primary settlement (collector) address
const ARTIST = 'G'.repeat(56); // a distinct artist snapshot address
const DAY_MS = 86_400_000;

let idSeq = 0;
function contract(over: Partial<FractionContract> = {}): FractionContract {
  idSeq++;
  return {
    id: `contract-${idSeq}`,
    artworkId: `artwork-${idSeq}`,
    status: 'deployed',
    tokenAddress: `T${idSeq}`.padEnd(56, '0'),
    artistAddress: ARTIST,
    artistRetentionAmount: null,
    artistLockupDays: 730,
    createdAt: new Date(),
    ...over,
  } as unknown as FractionContract;
}

function artwork(id: string, over: Partial<Artwork> = {}): Artwork {
  return {
    id,
    title: 'Northern Lights',
    primaryImageUrl: 'https://cdn.tove.test/aw.jpg',
    artistHandle: 'sophie-tove',
    ...over,
  } as unknown as Artwork;
}

function build() {
  const walletsService = { resolvePrimarySettlementAddress: vi.fn().mockResolvedValue(WALLET) };
  const contracts = { findAllDeployed: vi.fn().mockResolvedValue([]) };
  const artworks = { findByIds: vi.fn().mockResolvedValue([]) };
  const reader = { balancesOf: vi.fn().mockResolvedValue(new Map<string, string>()) };
  const cache = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) };
  const cfg = { fanOutWarnThreshold: 200 };
  const service = new MeHoldingsService(
    walletsService as never,
    contracts as never,
    artworks as never,
    reader,
    cache as never,
    cfg as never,
  );
  return { service, walletsService, contracts, artworks, reader, cache };
}

beforeEach(() => {
  idSeq = 0;
});

describe('MeHoldingsService.listHoldings', () => {
  it('returns [] and skips all reads when the caller has no primary wallet', async () => {
    const t = build();
    t.walletsService.resolvePrimarySettlementAddress.mockResolvedValue(null);
    await expect(t.service.listHoldings('user-1')).resolves.toEqual([]);
    expect(t.cache.get).not.toHaveBeenCalled();
    expect(t.reader.balancesOf).not.toHaveBeenCalled();
  });

  it('serves a cache hit without touching the DB or RPC', async () => {
    const t = build();
    const cached = [{ artworkId: 'a', balance: '60' }];
    t.cache.get.mockResolvedValue(cached);
    await expect(t.service.listHoldings('user-1')).resolves.toEqual(cached);
    expect(t.contracts.findAllDeployed).not.toHaveBeenCalled();
    expect(t.reader.balancesOf).not.toHaveBeenCalled();
  });

  it('returns [] (and caches it) when there are no deployed contracts', async () => {
    const t = build();
    await expect(t.service.listHoldings('user-1')).resolves.toEqual([]);
    expect(t.cache.set).toHaveBeenCalledWith(WALLET, []);
    expect(t.reader.balancesOf).not.toHaveBeenCalled();
  });

  it('Gherkin #1: a collector with 60 fractions → balance 60, free 60, locked 0', async () => {
    const t = build();
    const c = contract({ artworkId: 'aw-1' });
    t.contracts.findAllDeployed.mockResolvedValue([c]);
    t.artworks.findByIds.mockResolvedValue([artwork('aw-1')]);
    t.reader.balancesOf.mockResolvedValue(new Map([[c.tokenAddress as string, '60']]));

    const out = await t.service.listHoldings('user-1');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ balance: '60', lockedBalance: '0', freeBalance: '60', artworkId: 'aw-1' });
    expect(t.cache.set).toHaveBeenCalledWith(WALLET, out);
  });

  it('Gherkin #2: artist with 10 retained under an active lockup → locked 10, free 0', async () => {
    const t = build();
    t.walletsService.resolvePrimarySettlementAddress.mockResolvedValue(ARTIST);
    const c = contract({
      artworkId: 'aw-1',
      artistAddress: ARTIST,
      artistRetentionAmount: '10',
      artistLockupDays: 730,
      createdAt: new Date(), // lockup just started
    });
    t.contracts.findAllDeployed.mockResolvedValue([c]);
    t.artworks.findByIds.mockResolvedValue([artwork('aw-1')]);
    t.reader.balancesOf.mockResolvedValue(new Map([[c.tokenAddress as string, '10']]));

    const out = await t.service.listHoldings('artist-1');
    expect(out[0]).toMatchObject({ balance: '10', lockedBalance: '10', freeBalance: '0' });
  });

  it('artist after lockup expiry → locked 0, free 10', async () => {
    const t = build();
    t.walletsService.resolvePrimarySettlementAddress.mockResolvedValue(ARTIST);
    const c = contract({
      artworkId: 'aw-1',
      artistAddress: ARTIST,
      artistRetentionAmount: '10',
      artistLockupDays: 30,
      createdAt: new Date(Date.now() - 31 * DAY_MS), // lockup ended yesterday
    });
    t.contracts.findAllDeployed.mockResolvedValue([c]);
    t.artworks.findByIds.mockResolvedValue([artwork('aw-1')]);
    t.reader.balancesOf.mockResolvedValue(new Map([[c.tokenAddress as string, '10']]));

    const out = await t.service.listHoldings('artist-1');
    expect(out[0]).toMatchObject({ lockedBalance: '0', freeBalance: '10' });
  });

  it('lockup boundary is inclusive-end: locked just before end, unlocked at/after end (fail-open)', async () => {
    const mk = (createdAt: Date) => {
      const t = build();
      t.walletsService.resolvePrimarySettlementAddress.mockResolvedValue(ARTIST);
      const c = contract({ artworkId: 'aw-1', artistAddress: ARTIST, artistRetentionAmount: '10', artistLockupDays: 10, createdAt });
      t.contracts.findAllDeployed.mockResolvedValue([c]);
      t.artworks.findByIds.mockResolvedValue([artwork('aw-1')]);
      t.reader.balancesOf.mockResolvedValue(new Map([[c.tokenAddress as string, '10']]));
      return t;
    };
    // 1s before the end → still locked
    const beforeEnd = await mk(new Date(Date.now() - (10 * DAY_MS - 1000))).service.listHoldings('artist-1');
    expect(beforeEnd[0]).toMatchObject({ lockedBalance: '10', freeBalance: '0' });
    // 1ms past the end → released (now >= lockupEndMs)
    const atEnd = await mk(new Date(Date.now() - (10 * DAY_MS + 1))).service.listHoldings('artist-1');
    expect(atEnd[0]).toMatchObject({ lockedBalance: '0', freeBalance: '10' });
  });

  it('non-artist holder of a locked-artist artwork → locked 0 (lockup applies only to the retained position)', async () => {
    const t = build(); // caller wallet is WALLET (collector), not ARTIST
    const c = contract({
      artworkId: 'aw-1',
      artistAddress: ARTIST,
      artistRetentionAmount: '10',
      artistLockupDays: 730,
      createdAt: new Date(),
    });
    t.contracts.findAllDeployed.mockResolvedValue([c]);
    t.artworks.findByIds.mockResolvedValue([artwork('aw-1')]);
    t.reader.balancesOf.mockResolvedValue(new Map([[c.tokenAddress as string, '25']]));

    const out = await t.service.listHoldings('user-1');
    expect(out[0]).toMatchObject({ balance: '25', lockedBalance: '0', freeBalance: '25' });
  });

  it('lockedBalance is min(balance, retention) when a partial position was sold post-unlock drift', async () => {
    const t = build();
    t.walletsService.resolvePrimarySettlementAddress.mockResolvedValue(ARTIST);
    const c = contract({
      artworkId: 'aw-1',
      artistAddress: ARTIST,
      artistRetentionAmount: '10', // snapshot says 10 retained
      artistLockupDays: 730,
      createdAt: new Date(),
    });
    t.contracts.findAllDeployed.mockResolvedValue([c]);
    t.artworks.findByIds.mockResolvedValue([artwork('aw-1')]);
    t.reader.balancesOf.mockResolvedValue(new Map([[c.tokenAddress as string, '5']])); // but only 5 on-chain

    const out = await t.service.listHoldings('artist-1');
    expect(out[0]).toMatchObject({ balance: '5', lockedBalance: '5', freeBalance: '0' });
  });

  it('filters out zero-balance contracts and contracts with a null token address', async () => {
    const t = build();
    const held = contract({ artworkId: 'aw-1' });
    const zero = contract({ artworkId: 'aw-2' });
    const undeployed = contract({ artworkId: 'aw-3', tokenAddress: null });
    t.contracts.findAllDeployed.mockResolvedValue([held, zero, undeployed]);
    t.artworks.findByIds.mockResolvedValue([artwork('aw-1'), artwork('aw-2')]);
    t.reader.balancesOf.mockResolvedValue(
      new Map([
        [held.tokenAddress as string, '7'],
        [zero.tokenAddress as string, '0'],
      ]),
    );

    const out = await t.service.listHoldings('user-1');
    expect(out).toHaveLength(1);
    expect(out[0].artworkId).toBe('aw-1');
    // null-token contract is excluded before the RPC read
    expect(t.reader.balancesOf).toHaveBeenCalledWith(
      [held.tokenAddress, zero.tokenAddress],
      WALLET,
    );
  });

  it('coalesces concurrent same-wallet requests into one fan-out (single-flight)', async () => {
    const t = build();
    const c = contract({ artworkId: 'aw-1' });
    t.contracts.findAllDeployed.mockResolvedValue([c]);
    t.artworks.findByIds.mockResolvedValue([artwork('aw-1')]);
    let resolveRead!: (m: Map<string, string>) => void;
    t.reader.balancesOf.mockImplementation(
      () => new Promise<Map<string, string>>((r) => (resolveRead = r)),
    );

    const p1 = t.service.listHoldings('user-1');
    const p2 = t.service.listHoldings('user-1');
    await new Promise((r) => setImmediate(r)); // let both reach the in-flight stage
    resolveRead(new Map([[c.tokenAddress as string, '9']]));
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(t.reader.balancesOf).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
    expect(r1[0]).toMatchObject({ balance: '9' });
  });

  it('maps a single balance read failure to 503 HOLDINGS_UNAVAILABLE and caches nothing', async () => {
    const t = build();
    const c = contract({ artworkId: 'aw-1' });
    t.contracts.findAllDeployed.mockResolvedValue([c]);
    t.reader.balancesOf.mockRejectedValue(new FractionReadUnavailableError('balance read unavailable'));

    let caught: unknown;
    try {
      await t.service.listHoldings('user-1');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpException);
    const e = caught as HttpException;
    expect(e.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect((e.getResponse() as { errorCode: string }).errorCode).toBe(ErrorCode.HOLDINGS_UNAVAILABLE);
    expect((e.getResponse() as { message: string }).message).toBe('Holdings are temporarily unavailable');
    expect(t.cache.set).not.toHaveBeenCalled();
  });
});
