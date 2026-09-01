import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { kycConfig } from '@config/kyc.config';
import {
  SupabaseStorageService,
  STORAGE_BUCKET_OVERRIDE,
} from '@modules/storage/supabase-storage.service';
import { KYC_STORAGE } from './kyc.util';

/**
 * Provides + exports the `KYC_STORAGE` binding — a `SupabaseStorageService` bound to the private KYC
 * bucket via the `STORAGE_BUCKET_OVERRIDE` token (through DI, no hand-rolled `new`). Shared by the public
 * submit surface (`PublicKycModule`) and the orphan-blob sweeper (`KycSweepModule`) so there is one
 * instance and one wiring.
 */
@Module({
  providers: [
    {
      provide: STORAGE_BUCKET_OVERRIDE,
      useFactory: (kycCfg: ConfigType<typeof kycConfig>) => kycCfg.bucket,
      inject: [kycConfig.KEY],
    },
    { provide: KYC_STORAGE, useClass: SupabaseStorageService },
  ],
  exports: [KYC_STORAGE],
})
export class KycStorageModule {}
