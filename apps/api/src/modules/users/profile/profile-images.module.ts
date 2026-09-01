import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfileImage } from './entities/profile-image.entity';
import { ProfileImageRepository } from './repositories/profile-image.repository';
import { PROFILE_IMAGE_REPOSITORY } from './repositories/profile-image-repository.interface';

/**
 * Neutral profile-image domain (TOV-30): the `ProfileImage` entity + repository only. Imported by the
 * public surface (controllers/service), the derivative worker, and the maintenance jobs — none of which
 * depend on each other. Exports the repository token.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ProfileImage])],
  providers: [{ provide: PROFILE_IMAGE_REPOSITORY, useClass: ProfileImageRepository }],
  exports: [PROFILE_IMAGE_REPOSITORY],
})
export class ProfileImagesModule {}
