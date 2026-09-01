import { Module } from '@nestjs/common';
import { ProfileImagesModule } from './profile-images.module';
import { ProfileStorageModule } from './storage/profile-storage.module';
import { ProfileErasureService } from './profile-erasure.service';

/**
 * Neutral module exposing {@link ProfileErasureService} (TOV-30 #414). Imported by the backoffice users
 * surface (the admin delete path) so the neutral UsersModule stays free of profile/storage deps.
 */
@Module({
  imports: [ProfileImagesModule, ProfileStorageModule],
  providers: [ProfileErasureService],
  exports: [ProfileErasureService],
})
export class ProfileErasureModule {}
