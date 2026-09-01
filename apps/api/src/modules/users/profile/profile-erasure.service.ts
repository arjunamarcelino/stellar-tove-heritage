import { Inject, Injectable, Logger } from '@nestjs/common';
import { IProfileStorageService } from '@modules/storage/storage-service.interface';
import {
  PROFILE_IMAGE_REPOSITORY,
  IProfileImageRepository,
} from './repositories/profile-image-repository.interface';
import {
  PROFILE_PUBLIC_STORAGE,
  PROFILE_DERIVATIVE_SPECS,
  profilePublicDerivativePath,
} from './constants/profile-image.constants';

/**
 * Account-erasure purge for profile images (TOV-30 #414). Called when a user is (soft-)deleted: unpublishes
 * every public avatar copy immediately and soft-deletes all of the user's image rows. The reaper's
 * soft-deleted branch then reclaims the private blobs (its NOT EXISTS guard now ignores soft-deleted users,
 * so the deleted user's dangling FK no longer protects the rows). Best-effort — failures are logged.
 */
@Injectable()
export class ProfileErasureService {
  private readonly logger = new Logger(ProfileErasureService.name);

  constructor(
    @Inject(PROFILE_IMAGE_REPOSITORY) private readonly images: IProfileImageRepository,
    @Inject(PROFILE_PUBLIC_STORAGE) private readonly publicStorage: IProfileStorageService,
  ) {}

  async purgeForUser(userId: string): Promise<void> {
    const imgs = await this.images.findAllForUser(userId);
    const publicPaths = imgs.flatMap((img) =>
      PROFILE_DERIVATIVE_SPECS.map(([, size]) => profilePublicDerivativePath(img.id, size)),
    );
    if (publicPaths.length > 0) await this.publicStorage.deleteMany(publicPaths);
    await this.images.softDeleteAllForUser(userId);
    if (imgs.length > 0) this.logger.log(`erased ${imgs.length} profile image(s) for deleted user`);
  }
}
