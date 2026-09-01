import { Inject, Injectable, Logger } from '@nestjs/common';
import { IProfileStorageService } from '@modules/storage/storage-service.interface';
import {
  PROFILE_IMAGE_REPOSITORY,
  IProfileImageRepository,
} from '../repositories/profile-image-repository.interface';
import {
  PROFILE_SOURCE_STORAGE,
  PROFILE_PUBLIC_STORAGE,
  PROFILE_DERIVATIVE_SPECS,
  PROFILE_ORPHAN_GRACE_HOURS,
  profilePrivateDerivativePath,
  profilePublicDerivativePath,
} from '../constants/profile-image.constants';

/**
 * DB-driven reaper (TOV-30): deletes the blobs + DB row for abandoned uploads (`pending`/`failed` past the
 * grace window) and soft-deleted rows. No full-bucket scan — because `POST /me/profile-image` inserts the
 * `pending` row BEFORE minting the URL, the DB fully describes every blob. Best-effort deletes (storage
 * `delete` never throws); the row is hard-deleted last so a crash mid-purge just re-lists it next run.
 */
@Injectable()
export class ProfileImageReaperService {
  private readonly logger = new Logger(ProfileImageReaperService.name);

  constructor(
    @Inject(PROFILE_IMAGE_REPOSITORY) private readonly images: IProfileImageRepository,
    @Inject(PROFILE_SOURCE_STORAGE) private readonly sourceStorage: IProfileStorageService,
    @Inject(PROFILE_PUBLIC_STORAGE) private readonly publicStorage: IProfileStorageService,
  ) {}

  async reap(): Promise<{ reaped: number }> {
    const cutoff = new Date(Date.now() - PROFILE_ORPHAN_GRACE_HOURS * 60 * 60 * 1000);
    const rows = await this.images.findReapable(cutoff, 200);
    if (rows.length === 0) return { reaped: 0 };

    // Collect all paths, then batch-delete per bucket (one round-trip per chunk) instead of ~7 serial
    // deletes per row. Blobs are deleted before the DB rows, so a crash mid-purge just re-lists next run.
    const publicPaths: string[] = [];
    const privatePaths: string[] = [];
    for (const img of rows) {
      for (const [, size] of PROFILE_DERIVATIVE_SPECS) {
        publicPaths.push(profilePublicDerivativePath(img.id, size));
        privatePaths.push(profilePrivateDerivativePath(img.id, size));
      }
      privatePaths.push(img.sourcePath);
    }
    await this.publicStorage.deleteMany(publicPaths);
    await this.sourceStorage.deleteMany(privatePaths);
    for (const img of rows) await this.images.hardDelete(img.id);

    this.logger.log(`profile image reaper: reaped=${rows.length}`);
    return { reaped: rows.length };
  }
}
