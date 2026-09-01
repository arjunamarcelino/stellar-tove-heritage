import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ArtworksService } from '@modules/artworks/artworks.service';
import type { IArtworkReadRepository, ArtworkDetailRecord } from '@modules/artworks/repositories/artwork-read-repository.interface';
import type { IStorageService } from '@modules/storage/storage-service.interface';

const UUID = '00000000-0000-4000-8000-0000000a0001';
const TTL = 3600;

const repo = {
  findAll: vi.fn(),
  findOneById: vi.fn(),
} satisfies IArtworkReadRepository;

const storage = {
  upload: vi.fn(),
  createTemporaryUrl: vi.fn(),
  createTemporaryUrls: vi.fn(),
  delete: vi.fn(),
} satisfies IStorageService;

function detailRecord(overrides: Partial<ArtworkDetailRecord> = {}): ArtworkDetailRecord {
  return {
    id: UUID,
    title: 'Northern Lights',
    year: 1998,
    medium: 'Oil on canvas',
    dimensions: '80x120 cm',
    artistHandle: 'sophie-tove',
    artistName: 'Sophie Tove',
    primaryImageUrl: 'https://cdn.tove.test/aw-001.jpg',
    status: 'verified',
    custodian: 'Tove Vault, Oslo',
    coaStoragePath: null,
    supportingImages: [],
    ...overrides,
  };
}

describe('ArtworksService', () => {
  let service: ArtworksService;

  beforeEach(() => {
    vi.clearAllMocks();
    storage.createTemporaryUrls.mockImplementation((paths: string[]) =>
      Promise.resolve(paths.map((p) => `signed:${p}`)),
    );
    service = new ArtworksService(repo, storage, { signedUrlTtl: TTL });
  });

  describe('list', () => {
    it('maps records and pushes the 50-cap to the repo seam; never signs', async () => {
      repo.findAll.mockResolvedValue([detailRecord({ id: UUID, status: 'verified' })]);

      const result = await service.list();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(UUID);
      expect(repo.findAll).toHaveBeenCalledWith(50);
      expect(storage.createTemporaryUrl).not.toHaveBeenCalled();
      expect(storage.createTemporaryUrls).not.toHaveBeenCalled();
    });

    it('returns an empty { data: [] } when the repo has no records', async () => {
      repo.findAll.mockResolvedValue([]);
      expect((await service.list()).data).toEqual([]);
    });
  });

  describe('findOneById — visibility & 404 (non-oracle)', () => {
    const expected404 = {
      statusCode: 404,
      error: 'Not Found',
      message: 'Artwork not found',
      errorCode: 'ARTWORK_NOT_FOUND',
    };

    it('returns 200 and passes the status through (per-status visibility lives in the repo layer)', async () => {
      repo.findOneById.mockResolvedValue(detailRecord({ status: 'fractionalized' }));
      const result = await service.findOneById(UUID);
      expect(result.status).toBe('fractionalized');
      expect(repo.findOneById).toHaveBeenCalledWith(UUID);
    });

    it('maps nullable scalar fields through as null', async () => {
      repo.findOneById.mockResolvedValue(
        detailRecord({ year: null, medium: null, dimensions: null, artistName: null, artistHandle: null, primaryImageUrl: null, custodian: null }),
      );
      const result = await service.findOneById(UUID);
      expect(result.year).toBeNull();
      expect(result.medium).toBeNull();
      expect(result.custodian).toBeNull();
      expect(result.primaryImageUrl).toBeNull();
    });

    it('throws an identical 404 body when the repo returns null (unknown/wrong-status/soft-deleted)', async () => {
      repo.findOneById.mockResolvedValue(null);
      await expect(service.findOneById(UUID)).rejects.toMatchObject({ response: expected404 });
    });

    it('throws 404 for a non-UUID id WITHOUT hitting the repo', async () => {
      await expect(service.findOneById('not-a-uuid')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findOneById).not.toHaveBeenCalled();
    });

    it('throws 404 for an oversized id WITHOUT hitting the repo', async () => {
      await expect(service.findOneById('a'.repeat(129))).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findOneById).not.toHaveBeenCalled();
    });

    it('returns the same 404 body for the non-UUID branch as for the repo-miss branch', async () => {
      const miss = await service.findOneById('not-a-uuid').catch((e: NotFoundException) => e.getResponse());
      repo.findOneById.mockResolvedValue(null);
      const notFound = await service.findOneById(UUID).catch((e: NotFoundException) => e.getResponse());
      expect(miss).toEqual(notFound);
      expect(miss).toEqual(expected404);
    });
  });

  describe('findOneById — signing (batched)', () => {
    it('signs supporting images + COA in ONE batch call, preserving image order', async () => {
      repo.findOneById.mockResolvedValue(
        detailRecord({ coaStoragePath: 'coa/1.pdf', supportingImages: ['a/1.jpg', 'a/2.jpg', 'a/3.jpg'] }),
      );
      const result = await service.findOneById(UUID);

      expect(result.supportingImages).toEqual(['signed:a/1.jpg', 'signed:a/2.jpg', 'signed:a/3.jpg']);
      expect(result.coaSignedUrl).toBe('signed:coa/1.pdf');
      // Exactly one round-trip for all N+1 assets, with the COA last and the configured TTL.
      expect(storage.createTemporaryUrls).toHaveBeenCalledTimes(1);
      expect(storage.createTemporaryUrls).toHaveBeenCalledWith(['a/1.jpg', 'a/2.jpg', 'a/3.jpg', 'coa/1.pdf'], TTL);
    });

    it('does not call storage at all when there are no images and no COA', async () => {
      repo.findOneById.mockResolvedValue(detailRecord({ supportingImages: [], coaStoragePath: null }));
      const result = await service.findOneById(UUID);
      expect(result.supportingImages).toEqual([]);
      expect(result.coaSignedUrl).toBeNull();
      expect(storage.createTemporaryUrls).not.toHaveBeenCalled();
    });

    it('signs the COA when present; null when absent', async () => {
      repo.findOneById.mockResolvedValue(detailRecord({ coaStoragePath: 'coa/1.pdf' }));
      expect((await service.findOneById(UUID)).coaSignedUrl).toBe('signed:coa/1.pdf');
      expect(storage.createTemporaryUrls).toHaveBeenCalledWith(['coa/1.pdf'], TTL);

      vi.clearAllMocks();
      repo.findOneById.mockResolvedValue(detailRecord({ coaStoragePath: null }));
      expect((await service.findOneById(UUID)).coaSignedUrl).toBeNull();
    });

    it('fails open per asset: a null in the batch → COA null, that image omitted, others kept', async () => {
      repo.findOneById.mockResolvedValue(
        detailRecord({ coaStoragePath: 'coa/bad.pdf', supportingImages: ['ok/1.jpg', 'bad/2.jpg', 'ok/3.jpg'] }),
      );
      // paths order: [ok/1, bad/2, ok/3, coa/bad]; storage returns null for the bad image + the COA.
      storage.createTemporaryUrls.mockImplementation((paths: string[]) =>
        Promise.resolve(paths.map((p) => (p === 'bad/2.jpg' || p === 'coa/bad.pdf' ? null : `signed:${p}`))),
      );
      const result = await service.findOneById(UUID);
      expect(result.supportingImages).toEqual(['signed:ok/1.jpg', 'signed:ok/3.jpg']);
      expect(result.coaSignedUrl).toBeNull();
    });

    it('fails open on a whole-batch rejection → images [] and coa null, still 200', async () => {
      repo.findOneById.mockResolvedValue(detailRecord({ coaStoragePath: 'coa/1.pdf', supportingImages: ['s/1.jpg'] }));
      storage.createTemporaryUrls.mockRejectedValue(new Error('supabase down'));
      const result = await service.findOneById(UUID);
      expect(result.supportingImages).toEqual([]);
      expect(result.coaSignedUrl).toBeNull();
    });

    it('passes the primary image through WITHOUT signing it', async () => {
      repo.findOneById.mockResolvedValue(detailRecord({ primaryImageUrl: 'https://cdn.tove.test/hero.jpg', supportingImages: ['s/1.jpg'] }));
      const result = await service.findOneById(UUID);
      expect(result.primaryImageUrl).toBe('https://cdn.tove.test/hero.jpg');
      expect(storage.createTemporaryUrls).toHaveBeenCalledWith(['s/1.jpg'], TTL); // primary not in the batch
    });

    it('times out a slow batch and omits every asset (fail-open on fail-slow)', async () => {
      vi.useFakeTimers();
      try {
        storage.createTemporaryUrls.mockReturnValue(new Promise<(string | null)[]>(() => {})); // never resolves
        repo.findOneById.mockResolvedValue(detailRecord({ coaStoragePath: 'coa/slow.pdf', supportingImages: ['slow/1.jpg'] }));
        const promise = service.findOneById(UUID);
        await vi.advanceTimersByTimeAsync(800);
        const result = await promise;
        expect(result.supportingImages).toEqual([]);
        expect(result.coaSignedUrl).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('never leaks raw storage paths as response keys', async () => {
      repo.findOneById.mockResolvedValue(detailRecord({ coaStoragePath: 'coa/1.pdf', supportingImages: ['s/1.jpg'] }));
      const result = await service.findOneById(UUID);
      const keys = Object.keys(result);
      expect(keys).not.toContain('coaStoragePath');
      expect(keys).not.toContain('storagePath');
    });
  });
});
