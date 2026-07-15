import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArtworksController } from '@modules/artworks/artworks.controller';
import { ArtworksService } from '@modules/artworks/artworks.service';
import { ArtworkResponseDto } from '@modules/artworks/dto/artwork-response.dto';
import { CollectionResponseDto } from '@common/dto/collection-response.dto';

const mockService = {
  list: vi.fn(),
  findOneById: vi.fn(),
};

describe('ArtworksController', () => {
  let controller: ArtworksController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new ArtworksController(mockService as unknown as ArtworksService);
  });

  it('list returns the service value', async () => {
    const value = CollectionResponseDto.create<ArtworkResponseDto>([]);
    mockService.list.mockResolvedValue(value);

    const result = await controller.list();

    expect(result).toBe(value);
    expect(mockService.list).toHaveBeenCalledTimes(1);
  });

  it('findOneById delegates to the service', async () => {
    const dto = new ArtworkResponseDto();
    mockService.findOneById.mockResolvedValue(dto);

    const result = await controller.findOneById('aw-001');

    expect(result).toBe(dto);
    expect(mockService.findOneById).toHaveBeenCalledWith('aw-001');
  });

  it('is marked @Public() at the class level', () => {
    expect(Reflect.getMetadata('isPublic', ArtworksController)).toBe(true);
  });
});
