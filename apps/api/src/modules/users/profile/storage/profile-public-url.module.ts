import { Module } from '@nestjs/common';
import {
  PROFILE_PUBLIC_URL,
  ProfilePublicUrlService,
} from './profile-public-url.service';

/**
 * Lightweight module exposing the public-avatar-URL builder (TOV-30 #413) — NO storage clients. Imported by
 * ProfileViewModule so the read path (and AuthModule via it) doesn't construct Supabase clients at boot.
 */
@Module({
  providers: [{ provide: PROFILE_PUBLIC_URL, useClass: ProfilePublicUrlService }],
  exports: [PROFILE_PUBLIC_URL],
})
export class ProfilePublicUrlModule {}
