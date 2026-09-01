import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { supabaseConfig } from '@config/supabase.config';
import { profileImageConfig } from '@config/profile-image.config';
import { SupabaseStorageService } from '@modules/storage/supabase-storage.service';
import { PROFILE_PUBLIC_STORAGE, PROFILE_SOURCE_STORAGE } from '../constants/profile-image.constants';

/**
 * Binds two `SupabaseStorageService` instances — the PRIVATE source bucket and the PUBLIC derivatives
 * bucket (TOV-30). A single module scope can bind only one `STORAGE_BUCKET_OVERRIDE`, and we need two
 * distinct buckets, so each is constructed by an explicit factory closed over its bucket name (the config
 * is injected, only the bucket string is passed positionally). Exposed under narrow `IProfileStorageService`
 * tokens; consumed by the profile service, derivative worker, and maintenance jobs.
 */
@Module({
  providers: [
    {
      provide: PROFILE_SOURCE_STORAGE,
      useFactory: (
        supaCfg: ConfigType<typeof supabaseConfig>,
        profileCfg: ConfigType<typeof profileImageConfig>,
      ) => new SupabaseStorageService(supaCfg, profileCfg.sourceBucket),
      inject: [supabaseConfig.KEY, profileImageConfig.KEY],
    },
    {
      provide: PROFILE_PUBLIC_STORAGE,
      useFactory: (
        supaCfg: ConfigType<typeof supabaseConfig>,
        profileCfg: ConfigType<typeof profileImageConfig>,
      ) => new SupabaseStorageService(supaCfg, profileCfg.publicBucket),
      inject: [supabaseConfig.KEY, profileImageConfig.KEY],
    },
  ],
  exports: [PROFILE_SOURCE_STORAGE, PROFILE_PUBLIC_STORAGE],
})
export class ProfileStorageModule {}
