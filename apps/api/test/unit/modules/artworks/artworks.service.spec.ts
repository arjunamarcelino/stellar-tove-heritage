import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ArtworksService } from '@modules/artworks/artworks.service';
import type { IArtworkReadRepository } from '@modules/artworks/repositories/artwork-read-repository.interface';
import { ARTWORK_FIXTURES } from '@modules/artworks/repositories/in-memory-artwork.repository';
import { ARTIST_FIXTURES } from '@modules/artists/repositories/in-memory-artist.repository';

const repo = {
  findAll: vi.fn(),
  findOneById: vi.fn(),
} satisfies IArtworkReadRepository;

describe('ArtworksService', () => {
  let service: ArtworksService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ArtworksService(repo);
  });

  it('list returns { data } of length 3 in fixture order', async () => {
    vi.mocked(repo.findAll).mockResolvedValue(ARTWORK_FIXTURES);

    const result = await service.list();

    expect(result.data).toHaveLength(3);
    expect(result.data.map((a) => a.id)).toEqual(['aw-001', 'aw-002', 'aw-003']);
    // The cap is pushed to the repository seam (not sliced in the service).
    expect(vi.mocked(repo.findAll)).toHaveBeenCalledWith(50);
  });

  it('list returns an empty { data: [] } when the repo has no records', async () => {
    vi.mocked(repo.findAll).mockResolvedValue([]);

    const result = await service.list();

    expect(result.data).toEqual([]);
  });

  it('findOneById returns the matching artwork', async () => {
    vi.mocked(repo.findOneById).mockResolvedValue(ARTWORK_FIXTURES[0]);

    const result = await service.findOneById('aw-001');

    expect(result.id).toBe('aw-001');
    expect(vi.mocked(repo.findOneById)).toHaveBeenCalledWith('aw-001');
  });

  it('findOneById throws NotFoundException for an unknown id', async () => {
    vi.mocked(repo.findOneById).mockResolvedValue(null);

    await expect(service.findOneById('nope')).rejects.toThrow(NotFoundException);
  });

  it('findOneById throws NotFoundException for an oversized id without hitting the repo', async () => {
    const longId = 'a'.repeat(129);

    await expect(service.findOneById(longId)).rejects.toThrow(NotFoundException);
    expect(vi.mocked(repo.findOneById)).not.toHaveBeenCalled();
  });

  describe('fixture integrity', () => {
    it('every artwork.artistHandle resolves to an artist fixture', () => {
      const handles = new Set(ARTIST_FIXTURES.map((artist) => artist.handle));
      for (const artwork of ARTWORK_FIXTURES) {
        expect(handles.has(artwork.artistHandle)).toBe(true);
      }
    });

    it('artwork ids are unique', () => {
      const ids = ARTWORK_FIXTURES.map((artwork) => artwork.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('all statuses are anonymous-visible', () => {
      const allowed = new Set(['verified', 'published']);
      for (const artwork of ARTWORK_FIXTURES) {
        expect(allowed.has(artwork.status)).toBe(true);
      }
    });
  });
});
