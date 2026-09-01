import { Inject, Injectable } from '@nestjs/common';
import {
  BENEFICIARY_REPOSITORY,
  IBeneficiaryRepository,
} from '../repositories/beneficiary-repository.interface';

/**
 * Erasure-reconcile backstop (TOV-31, review todo 418). Hard-deletes beneficiaries whose owning user is
 * soft-deleted — the safety net for the best-effort per-account `BeneficiaryErasureService.purgeForUser`
 * (which swallows errors and can be skipped by a crash between the user soft-delete and the purge call).
 */
@Injectable()
export class BeneficiaryErasureSweepService {
  constructor(@Inject(BENEFICIARY_REPOSITORY) private readonly repo: IBeneficiaryRepository) {}

  /** Purge orphaned beneficiary rows; returns the number deleted. */
  sweep(): Promise<number> {
    return this.repo.deleteOrphansOfDeletedUsers();
  }
}
