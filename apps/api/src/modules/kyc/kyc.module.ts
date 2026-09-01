import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdempotencyModule } from '@common/idempotency/idempotency.module';
import { User } from '@modules/users/entities/user.entity';
import { WalletsAuditModule } from '@modules/wallets/audit/wallets-audit.module';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { KycCryptoService } from './crypto/kyc-crypto.service';
import { ConfigKeyWrapper } from './crypto/config-key-wrapper';
import { KEY_WRAPPER } from './crypto/key-wrapper.interface';
import { KycSubmission } from './entities/kyc-submission.entity';
import { KycDocument } from './entities/kyc-document.entity';
import { KycSubmissionRepository } from './repositories/kyc-submission.repository';
import { KYC_SUBMISSION_REPOSITORY } from './repositories/kyc-submission-repository.interface';
import { MulterExceptionFilter } from './multer-exception.filter';
import { KycConcurrencyInterceptor } from './kyc-concurrency.interceptor';
import { KycStorageModule } from './kyc-storage.module';

/**
 * Public authenticated KYC surface (TOV-28), served under `api/v1/me/kyc...` (added to `PUBLIC_MODULES`).
 * Reuses `IdempotencyModule` (Idempotency-Key), the neutral `WalletsAuditModule` (append-only audit), and
 * `KycStorageModule` (the shared `KYC_STORAGE` binding to the private `tove-kyc` bucket). The
 * `MulterExceptionFilter` (global via `APP_FILTER`) maps interceptor-level Multer errors to KYC error codes.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([KycSubmission, KycDocument, User]),
    IdempotencyModule,
    WalletsAuditModule,
    KycStorageModule,
  ],
  controllers: [KycController],
  providers: [
    KycService,
    KycCryptoService,
    KycConcurrencyInterceptor,
    { provide: KEY_WRAPPER, useClass: ConfigKeyWrapper },
    { provide: KYC_SUBMISSION_REPOSITORY, useClass: KycSubmissionRepository },
    { provide: APP_FILTER, useClass: MulterExceptionFilter },
  ],
})
export class PublicKycModule {}
