import { EntityManager } from 'typeorm';
import { IBaseRepository } from '@common/repositories/base-repository.interface';
import { KycAllowlistEvent } from '../entities/kyc-allowlist-event.entity';
import { NewKycAllowlistEvent } from '../kyc-allowlist.types';

export const KYC_ALLOWLIST_EVENT_REPOSITORY = 'IKycAllowlistEventRepository';

export interface IKycAllowlistEventRepository extends IBaseRepository<KycAllowlistEvent> {
  /** Append one row per processed item, inside the caller's transaction (append-only; insert only). */
  append(rows: NewKycAllowlistEvent[], manager: EntityManager): Promise<void>;
}
