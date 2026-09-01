import { describe, it, expect, vi, beforeEach } from 'vitest';
import { In } from 'typeorm';
import { HttpException } from '@nestjs/common';
import { BackofficeArtworksService } from '../../../../src/modules/backoffice/artworks/backoffice-artworks.service';
import { ArtworkQueryDto } from '../../../../src/modules/backoffice/artworks/dto/artwork-query.dto';
import { assertActiveStatus } from '../../../../src/modules/backoffice/artworks/constants/active-fraction-status';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';

const A1 = '00000000-0000-4000-8000-0000000a0001';
const A2 = '00000000-0000-4000-8000-0000000a0002';

const artworkRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: A1,
  title: 'Northern Lights',
  year: 2021,
  medium: 'Oil',
  dimensions: '100x80',
  artistUserId: 'u1',
  artistName: 'Jane',
  artistHandle: 'jane',
  primaryImageUrl: 'https://img/1.png',
  status: 'verified',
  ...over,
});

const contractRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'fc1',
  artworkId: A1,
  status: 'deployed',
  tokenAddress: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
  totalSupply: '1000000',
  artistRetentionPct: 10,
  treasuryRetentionPct: 5,
  artistLockupDays: 365,
  treasuryLockupDays: 730,
  tokenName: 'Northern Lights',
  tokenSymbol: 'NLIGHT',
  ...over,
});

const offeringRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'off1',
  status: 'planned',
  lowPriceStroops: '50000000',
  highPriceStroops: '150000000',
  publicFloat: '900000',
  windowOpenAt: new Date('2026-09-01T00:00:00.000Z'),
  windowCloseAt: new Date('2026-09-08T00:00:00.000Z'),
  ...over,
});

function build(over: {
  page?: [unknown[], number];
  active?: unknown[];
  one?: unknown;
  activeOne?: unknown;
  activeOfferingOne?: unknown;
}) {
  const artworks = {
    findWithPagination: vi.fn(() => Promise.resolve(over.page ?? [[], 0])),
    findOneById: vi.fn(() => Promise.resolve(over.one ?? null)),
  };
  const contracts = {
    findActiveByArtworkIds: vi.fn(() => Promise.resolve(over.active ?? [])),
    findActiveByArtworkId: vi.fn(() => Promise.resolve(over.activeOne ?? null)),
  };
  const offerings = {
    findActiveByArtworkId: vi.fn(() => Promise.resolve(over.activeOfferingOne ?? null)),
  };
  const service = new BackofficeArtworksService(
    artworks as never,
    contracts as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    offerings as never,
  );
  return { service, artworks, contracts, offerings };
}

const query = (over: Partial<ArtworkQueryDto> = {}): ArtworkQueryDto =>
  Object.assign(new ArtworkQueryDto(), { page: 1, limit: 10, ...over });

describe('BackofficeArtworksService.listArtworks', () => {
  beforeEach(() => vi.clearAllMocks());

  it('zips active contracts to rows by artworkId; unmatched → null; single batch call (no N+1)', async () => {
    const h = build({
      page: [[artworkRow({ id: A1 }), artworkRow({ id: A2, status: 'verified' })], 2],
      active: [contractRow({ artworkId: A1, status: 'deployed' })],
    });
    const res = await h.service.listArtworks(query());

    expect(h.contracts.findActiveByArtworkIds).toHaveBeenCalledTimes(1);
    expect(h.contracts.findActiveByArtworkIds).toHaveBeenCalledWith([A1, A2]);
    expect(res.data[0].fractionContract).toMatchObject({ status: 'deployed' });
    expect(res.data[1].fractionContract).toBeNull(); // A2 unmatched
    expect(res.meta).toEqual({ page: 1, limit: 10, total: 2, totalPages: 1 });
  });

  it('applies the default filter when no status is supplied', async () => {
    const h = build({ page: [[], 0] });
    await h.service.listArtworks(query());
    expect(h.artworks.findWithPagination).toHaveBeenCalledWith(
      { where: { status: In(['verified', 'fractionalizing', 'fractionalized']) }, order: { createdAt: 'DESC' } },
      1,
      10,
    );
  });

  it('uses the supplied CSV status subset when present', async () => {
    const h = build({ page: [[], 0] });
    await h.service.listArtworks(query({ status: ['fractionalized'] }));
    expect(h.artworks.findWithPagination).toHaveBeenCalledWith(
      { where: { status: In(['fractionalized']) }, order: { createdAt: 'DESC' } },
      1,
      10,
    );
  });

  it('page beyond total → empty data, correct meta', async () => {
    const h = build({ page: [[], 7] });
    const res = await h.service.listArtworks(query({ page: 99, limit: 10 }));
    expect(res.data).toEqual([]);
    expect(res.meta).toEqual({ page: 99, limit: 10, total: 7, totalPages: 1 });
  });
});

describe('BackofficeArtworksService.getArtwork', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps detail + active projection (totalSupply is a string)', async () => {
    const h = build({ one: artworkRow(), activeOne: contractRow({ status: 'deployed' }) });
    const res = await h.service.getArtwork(A1);
    expect(res.status).toBe('verified');
    expect(res.fractionContract?.status).toBe('deployed');
    expect(res.fractionContract?.totalSupply).toBe('1000000');
    expect(typeof res.fractionContract?.totalSupply).toBe('string');
  });

  it('404 ARTWORK_NOT_FOUND when missing/soft-deleted', async () => {
    const h = build({ one: null });
    await expect(h.service.getArtwork(A1)).rejects.toMatchObject({ status: 404 });
    await h.service.getArtwork(A1).catch((e) => {
      const body = (e as HttpException).getResponse() as { errorCode?: string };
      expect(body.errorCode).toBe(ErrorCode.ARTWORK_NOT_FOUND);
    });
  });

  it('failed-only → active finder returns null → fractionContract:null (CTA re-shows)', async () => {
    const h = build({ one: artworkRow({ status: 'verified' }), activeOne: null });
    const res = await h.service.getArtwork(A1);
    expect(res.fractionContract).toBeNull();
  });

  it('embeds activeOffering summary when a non-terminal offering exists (TOV-153)', async () => {
    const h = build({ one: artworkRow(), activeOfferingOne: offeringRow() });
    const res = await h.service.getArtwork(A1);
    expect(h.offerings.findActiveByArtworkId).toHaveBeenCalledWith(A1);
    expect(res.activeOffering).toMatchObject({
      id: 'off1',
      status: 'planned',
      lowPriceStroops: '50000000',
      highPriceStroops: '150000000',
      publicFloat: '900000',
      windowOpenAt: '2026-09-01T00:00:00.000Z', // Date → ISO string
      windowCloseAt: '2026-09-08T00:00:00.000Z',
    });
  });

  it('activeOffering is null when there is no active offering (CTA to plan is shown)', async () => {
    const h = build({ one: artworkRow(), activeOfferingOne: null });
    const res = await h.service.getArtwork(A1);
    expect(res.activeOffering).toBeNull();
  });
});

describe('assertActiveStatus (varchar-drift guard)', () => {
  it('returns deploying/deployed unchanged', () => {
    expect(assertActiveStatus('deploying')).toBe('deploying');
    expect(assertActiveStatus('deployed')).toBe('deployed');
  });

  it('throws 500 with a generic body (no raw status leaked) on an unexpected/drifted status', () => {
    expect(() => assertActiveStatus('failed')).toThrow(HttpException);
    try {
      assertActiveStatus('failed');
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(500);
      const body = (e as HttpException).getResponse() as { errorCode?: string; message?: string };
      expect(body.errorCode).toBe(ErrorCode.INTERNAL_ERROR);
      expect(body.message).toBe('Internal server error');
      expect(body.message).not.toContain('failed'); // drifted internal value never echoed
    }
  });
});
