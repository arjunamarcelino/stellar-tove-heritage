import { Module } from '@nestjs/common';
import { UsersModule } from '../users.module';
import { ProfileImagesModule } from './profile-images.module';
import { ProfilePublicUrlModule } from './storage/profile-public-url.module';
import { ProfileViewService } from './profile-view.service';

/**
 * Neutral module exposing {@link ProfileViewService} — the ONE profile-view builder shared by the public
 * `me` surface and AuthModule (`GET /auth/profile`). Imports the neutral user + profile-image repos and the
 * lightweight public-URL builder (NOT the storage clients — #413, so AuthModule doesn't construct Supabase
 * clients at boot). Must NOT import AuthModule (the user arrives as a method argument) — acyclic.
 */
@Module({
  imports: [UsersModule, ProfileImagesModule, ProfilePublicUrlModule],
  providers: [ProfileViewService],
  exports: [ProfileViewService],
})
export class ProfileViewModule {}
