import { IStorageService } from '@modules/storage/storage-service.interface';
import { KycDocType } from './enums/kyc-doc-type.enum';

/** DI token for the KYC-bucket storage provider (a `SupabaseStorageService` bound to `tove-kyc`). */
export const KYC_STORAGE = 'IKycStorageService';

/** The KYC storage contract: the base ops plus recursive listing for the orphan-blob sweeper (#193). */
export interface IKycStorageService extends IStorageService {
  listObjectsOlderThan(prefix: string, olderThanMs: number): Promise<string[]>;
}

/**
 * Object key in the private `tove-kyc` bucket. `submissionId` is a SECRET-keyed HMAC (see
 * `KycCryptoService.deterministicSubmissionId`), so the key is not reconstructable/enumerable from
 * client-known values; reads are additionally ownership-scoped.
 */
export function kycObjectKey(userId: string, submissionId: string, docType: KycDocType): string {
  return `${userId}/${submissionId}/${docType}`;
}
