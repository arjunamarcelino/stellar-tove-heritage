import { describe, it, expect, beforeEach, vi } from 'vitest';
import sharp from 'sharp';
import { ProfileDerivativeService } from '@modules/users/profile/derivatives/profile-derivative.service';
import { IProfileImageRepository } from '@modules/users/profile/repositories/profile-image-repository.interface';
import { ProfileImage } from '@modules/users/profile/entities/profile-image.entity';
import {
  profileSourcePath,
  profilePrivateDerivativePath,
  ProfileImageDerivatives,
} from '@modules/users/profile/constants/profile-image.constants';
import { FakeProfileStorage } from '../../../../shared/fake-profile-storage';
import { makeJpeg, makeTinyJpeg, notAnImage } from '../../../../shared/fixtures/images';

const USER = '11111111-1111-1111-1111-111111111111';
const IMAGE = '22222222-2222-2222-2222-222222222222';

function processingRow(): ProfileImage {
  const row = new ProfileImage();
  row.id = IMAGE;
  row.userId = USER;
  row.status = 'processing';
  row.sourcePath = profileSourcePath(USER, IMAGE);
  row.derivatives = {};
  return row;
}

describe('ProfileDerivativeService (TOV-30)', () => {
  let storage: FakeProfileStorage;
  let repo: { findById: ReturnType<typeof vi.fn>; markReady: ReturnType<typeof vi.fn>; markFailed: ReturnType<typeof vi.fn> };
  let service: ProfileDerivativeService;

  beforeEach(() => {
    storage = new FakeProfileStorage();
    repo = { findById: vi.fn(), markReady: vi.fn(), markFailed: vi.fn() };
    service = new ProfileDerivativeService(repo as unknown as IProfileImageRepository, storage);
  });

  it('generates 64/256/512 webp derivatives from a real image and marks ready', async () => {
    repo.findById.mockResolvedValue(processingRow());
    storage.putDirect(profileSourcePath(USER, IMAGE), await makeJpeg(800, 600));

    await service.generate(IMAGE);

    let saved: ProfileImageDerivatives = {};
    expect(repo.markReady).toHaveBeenCalledWith(IMAGE, expect.any(Object));
    saved = repo.markReady.mock.calls[0][1] as ProfileImageDerivatives;
    expect(Object.keys(saved).sort()).toEqual(['card', 'hero', 'thumb']);

    for (const [size, key] of [[64, 'thumb'], [256, 'card'], [512, 'hero']] as const) {
      const path = profilePrivateDerivativePath(IMAGE, size);
      expect(storage.has(path)).toBe(true);
      expect(saved[key]).toBe(path);
      const meta = await sharp(await storage.download(path)).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(size);
      expect(meta.height).toBe(size);
    }
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('does not upscale a tiny source (withoutEnlargement)', async () => {
    repo.findById.mockResolvedValue(processingRow());
    storage.putDirect(profileSourcePath(USER, IMAGE), await makeTinyJpeg()); // 32x32

    await service.generate(IMAGE);

    const meta = await sharp(await storage.download(profilePrivateDerivativePath(IMAGE, 512))).metadata();
    expect(meta.width).toBeLessThanOrEqual(32);
  });

  it('marks failed and throws terminal on a non-image', async () => {
    repo.findById.mockResolvedValue(processingRow());
    storage.putDirect(profileSourcePath(USER, IMAGE), notAnImage());

    await expect(service.generate(IMAGE)).rejects.toThrow();
    expect(repo.markFailed).toHaveBeenCalledWith(IMAGE);
    expect(repo.markReady).not.toHaveBeenCalled();
  });

  it('is a no-op when the row is already ready', async () => {
    const row = processingRow();
    row.status = 'ready';
    repo.findById.mockResolvedValue(row);

    await service.generate(IMAGE);
    expect(repo.markReady).not.toHaveBeenCalled();
  });
});
