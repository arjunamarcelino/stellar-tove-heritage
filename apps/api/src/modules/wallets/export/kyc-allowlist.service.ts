import { Inject, Injectable } from '@nestjs/common';
import {
  KYC_ALLOWLIST_REPOSITORY,
  IKycAllowlistRepository,
} from './repositories/kyc-allowlist-repository.interface';
import { canonicalizeStellarAddress } from './stellar-address.util';

/**
 * KYC allowlist gate for embedded-wallet export (FR-01.02c). The export target must be present on the
 * allowlist both at initiate AND at submit (a compliance revocation between the two must block the
 * money movement). Addresses are canonicalized before comparison so a non-canonical StrKey can never
 * near-miss or bypass the exact-match check.
 */
@Injectable()
export class KycAllowlistService {
  constructor(
    @Inject(KYC_ALLOWLIST_REPOSITORY) private readonly repo: IKycAllowlistRepository,
  ) {}

  /**
   * Whether `targetAddress` is an allowlisted destination. Returns false for a malformed address
   * (canonicalization throw) rather than surfacing a 500 — an un-parseable target is simply not allowed.
   */
  async isAllowed(targetAddress: string): Promise<boolean> {
    let canonical: string;
    try {
      canonical = canonicalizeStellarAddress(targetAddress);
    } catch {
      return false;
    }
    return this.repo.existsActive(canonical);
  }
}
