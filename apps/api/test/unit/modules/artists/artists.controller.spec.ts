import { describe, it, expect, vi } from 'vitest';
import { ArtistsController } from '@modules/artists/artists.controller';
import type { ArtistsService } from '@modules/artists/artists.service';
import { CollectionResponseDto } from '@common/dto/collection-response.dto';
import { ArtistResponseDto } from '@modules/artists/dto/artist-response.dto';

describe('ArtistsController', () => {
  const listResult = CollectionResponseDto.create<ArtistResponseDto>([]);
  const detailResult = ArtistResponseDto.fromRecord({ handle: 'sophie-tove', name: 'Sophie Tove' });

  const service = {
    list: vi.fn<() => Promise<CollectionResponseDto<ArtistResponseDto>>>().mockResolvedValue(
      listResult,
    ),
    findByHandle: vi.fn<(handle: string) => Promise<ArtistResponseDto>>().mockResolvedValue(
      detailResult,
    ),
  };
  const controller = new ArtistsController(service as unknown as ArtistsService);

  it('list() returns the service value', async () => {
    await expect(controller.list()).resolves.toBe(listResult);
    expect(service.list).toHaveBeenCalledTimes(1);
  });

  it('findByHandle() delegates to the service', async () => {
    await expect(controller.findByHandle('sophie-tove')).resolves.toBe(detailResult);
    expect(service.findByHandle).toHaveBeenCalledWith('sophie-tove');
  });

  it('is marked @Public() at the class level', () => {
    expect(Reflect.getMetadata('isPublic', ArtistsController)).toBe(true);
  });
});
