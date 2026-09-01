import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RelayerModule } from '@modules/relayer/relayer.module';
import { KycAllowlistEvent } from './entities/kyc-allowlist-event.entity';
import { KycAllowlistState } from './entities/kyc-allowlist-state.entity';
import { KYC_ALLOWLIST_EVENT_REPOSITORY } from './repositories/kyc-allowlist-event-repository.interface';
import { KycAllowlistEventRepository } from './repositories/kyc-allowlist-event.repository';
import { KYC_ALLOWLIST_STATE_REPOSITORY } from './repositories/kyc-allowlist-state-repository.interface';
import { KycAllowlistStateRepository } from './repositories/kyc-allowlist-state.repository';
import { KYC_ALLOWLIST_TX_SERVICE } from './kyc-allowlist-tx.service.interface';
import { SorobanKycAllowlistService } from './soroban-kyc-allowlist.service';

/**
 * Neutral on-chain KYC allowlist domain (TOV-235): the `kyc_allowlist_events` + `kyc_allowlist_state`
 * entities/repos and the `KYC_ALLOWLIST_TX_SERVICE` port. Provider-only (no route surface) — imported by the
 * backoffice leaf (there is no worker, so it is NOT imported into app.module). Imports `RelayerModule` for
 * the shared `RELAYER_ACCOUNT_LOCK`. Tests override `KYC_ALLOWLIST_TX_SERVICE` with an in-memory fake.
 */
@Module({
  imports: [TypeOrmModule.forFeature([KycAllowlistEvent, KycAllowlistState]), RelayerModule],
  providers: [
    { provide: KYC_ALLOWLIST_EVENT_REPOSITORY, useClass: KycAllowlistEventRepository },
    { provide: KYC_ALLOWLIST_STATE_REPOSITORY, useClass: KycAllowlistStateRepository },
    { provide: KYC_ALLOWLIST_TX_SERVICE, useClass: SorobanKycAllowlistService },
  ],
  exports: [
    KYC_ALLOWLIST_EVENT_REPOSITORY,
    KYC_ALLOWLIST_STATE_REPOSITORY,
    KYC_ALLOWLIST_TX_SERVICE,
    TypeOrmModule,
  ],
})
export class KycAllowlistModule {}
