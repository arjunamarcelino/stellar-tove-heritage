import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BENEFICIARY_REPOSITORY,
  IBeneficiaryRepository,
} from './repositories/beneficiary-repository.interface';

/**
 * Account-erasure purge for beneficiary designations (TOV-31, resolves security review C1). Called when a
 * user is (soft-)deleted: HARD-deletes the user's beneficiary row so the third party's PII is physically
 * removed (account soft-delete never fires the FK CASCADE). Best-effort — failures are logged, never thrown,
 * so an erasure hiccup can't block the user delete (mirrors {@link ProfileErasureService}).
 */
@Injectable()
export class BeneficiaryErasureService {
  private readonly logger = new Logger(BeneficiaryErasureService.name);

  constructor(@Inject(BENEFICIARY_REPOSITORY) private readonly repo: IBeneficiaryRepository) {}

  async purgeForUser(userId: string): Promise<void> {
    try {
      const removedId = await this.repo.deleteByUserId(userId);
      if (removedId !== null) this.logger.log('erased beneficiary for deleted user');
    } catch (err) {
      this.logger.error(`failed to erase beneficiary for deleted user: ${String(err)}`);
    }
  }
}
