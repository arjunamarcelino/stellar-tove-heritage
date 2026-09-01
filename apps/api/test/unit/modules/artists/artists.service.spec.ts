import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ArtistsService } from '@modules/artists/artists.service';
import type {
  ArtistRecord,
  IArtistReadRepository,
} from '@modules/artists/repositories/artist-read-repository.interface';
import { ARTIST_FIXTURES } from '@modules/artists/repositories/in-memory-artist.repository';
import { ErrorCode } from '@common/enums/error-code.enum';

const HANDLE_REGEX = /^[a-z0-9-]{1,64}$/;

describe('ArtistsService', () => {
  const repo = {
    findAll: vi.fn<() => Promise<readonly ArtistRecord[]>>(),
    findByHandle: vi.fn<(handle: string) => Promise<ArtistRecord | null>>(),
  };
  let service: ArtistsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ArtistsService(repo satisfies IArtistReadRepository);
  });

  describe('fixtures', () => {
    it('have unique handles matching the slug regex', () => {
      const handles = ARTIST_FIXTURES.map((a) => a.handle);
      expect(new Set(handles).size).toBe(handles.length);
      for (const handle of handles) {
        expect(HANDLE_REGEX.test(handle)).toBe(true);
      }
    });
  });

  describe('list', () => {
    it('returns { data } of length 2 in fixture order', async () => {
      repo.findAll.mockResolvedValue(ARTIST_FIXTURES);
      const result = await service.list();
      expect(result.data).toHaveLength(2);
      expect(result.data.map((a) => a.handle)).toEqual(['sophie-tove', 'ari-lund']);
      // The cap is pushed to the repository seam (not sliced in the service).
      expect(repo.findAll).toHaveBeenCalledWith(50);
    });

    it('returns an empty { data: [] } when the repo has no records', async () => {
      repo.findAll.mockResolvedValue([]);
      const result = await service.list();
      expect(result.data).toEqual([]);
    });
  });

  describe('findByHandle', () => {
    it('returns the artist for a known handle', async () => {
      repo.findByHandle.mockResolvedValue(ARTIST_FIXTURES[0]);
      const result = await service.findByHandle('sophie-tove');
      expect(result.handle).toBe('sophie-tove');
      expect(result.name).toBe('Sophie Tove');
    });

    it('throws NotFoundException (ARTIST_NOT_FOUND) for an unknown handle', async () => {
      repo.findByHandle.mockResolvedValue(null);
      let caught: NotFoundException | undefined;
      try {
        await service.findByHandle('nope');
      } catch (err) {
        caught = err as NotFoundException;
      }
      expect(caught).toBeInstanceOf(NotFoundException);
      expect((caught?.getResponse() as { errorCode: string }).errorCode).toBe(
        ErrorCode.ARTIST_NOT_FOUND,
      );
    });

    it('throws NotFoundException for an invalid-charset handle without hitting the repo', async () => {
      await expect(service.findByHandle('Bad Handle!')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findByHandle).not.toHaveBeenCalled();
    });
  });
});
