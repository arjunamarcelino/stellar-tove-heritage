import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycDocument } from '../entities/kyc-document.entity';
import { KycStorageModule } from '../kyc-storage.module';
import { KYC_ORPHAN_SWEEP_QUEUE } from './kyc-sweep.constants';
import { KycOrphanSweepService } from './kyc-orphan-sweep.service';
import { KycOrphanSweepProcessor } from './kyc-orphan-sweep.processor';
import { KycSweepScheduler } from './kyc-sweep.scheduler';

/**
 * Provider-only module (imported by `app.module`, not a route surface): the KYC orphan-blob sweeper
 * (review #193). Registers the `kyc-orphan-sweep` BullMQ queue + processor, the reconciliation service,
 * and the boot-time scheduler. Reuses the shared `KYC_STORAGE` binding via `KycStorageModule`.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: KYC_ORPHAN_SWEEP_QUEUE }),
    TypeOrmModule.forFeature([KycDocument]),
    KycStorageModule,
  ],
  providers: [KycOrphanSweepService, KycOrphanSweepProcessor, KycSweepScheduler],
})
export class KycSweepModule {}
