import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { isUniqueConstraintError } from '@common/utils/database.utils';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { AUDIT_KIND, NewAuditEntry } from '@modules/wallets/audit/audit-log.types';
import { USER_REPOSITORY, IUserRepository } from '@modules/users/repositories/user-repository.interface';
import {
  BENEFICIARY_REPOSITORY,
  BeneficiaryWriteFields,
  IBeneficiaryRepository,
} from './repositories/beneficiary-repository.interface';
import { Beneficiary } from './entities/beneficiary.entity';
import { SetBeneficiaryDto } from './dto/set-beneficiary.dto';
import { BeneficiaryResponseDto } from './dto/beneficiary-response.dto';

const UNIQUE_ACTIVE_INDEX = 'UQ_beneficiaries_user_active';

/**
 * Upsert attempt bound. Each attempt re-reads and re-branches insert-or-update; an attempt is retried on
 * EITHER recoverable race (a 23505 insert race, or `applyUpdate → null` from a concurrent hard-delete).
 * A single unlocked request would have to lose that race on every one of these attempts to exhaust the loop
 * — practically impossible for one owner against a 20/min-throttled endpoint — so the exhaustion path is a
 * fail-safe transient backstop, never a data-integrity concern (each attempt is its own transaction).
 */
const MAX_SET_ATTEMPTS = 5;

/** The writable fields, in order — the single source for the change diff (drift-guarded via `satisfies`). */
const BENEFICIARY_WRITE_FIELDS = ['name', 'email', 'stellarPubkey', 'relationship', 'notes'] as const satisfies
  readonly (keyof BeneficiaryWriteFields)[];
type BeneficiaryWriteKey = (typeof BENEFICIARY_WRITE_FIELDS)[number];

/** Audit payload — a discriminated union on `operation` (no PII: only which keys changed). */
type BeneficiaryAuditPayload =
  | { operation: 'created'; changedFields: BeneficiaryWriteKey[] }
  | { operation: 'updated'; changedFields: BeneficiaryWriteKey[] }
  | { operation: 'removed' };

/** Trim + null-coalesce an optional free-text field (omitted/blank/whitespace → null). */
const optional = (v: string | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * Beneficiary designation service (TOV-31). Owner-scoped set/read/remove of a Collector's single
 * inheritance beneficiary. Pure DB: the upsert + audit run in one transaction (fail-closed); the KYC
 * status (for the notice) is read outside the write txn.
 */
@Injectable()
export class BeneficiaryService {
  constructor(
    @Inject(BENEFICIARY_REPOSITORY) private readonly repo: IBeneficiaryRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    private readonly audit: AuditLogService,
  ) {}

  async getBeneficiary(userId: string): Promise<BeneficiaryResponseDto> {
    // Two independent point-reads — run concurrently.
    const [row, kycStatus] = await Promise.all([this.repo.findByUserId(userId), this.kycStatusOf(userId)]);
    return BeneficiaryResponseDto.build(row, kycStatus);
  }

  async setBeneficiary(userId: string, dto: SetBeneficiaryDto): Promise<BeneficiaryResponseDto> {
    const fields = this.normalize(dto);
    // Bounded retry; each attempt re-reads and re-branches insert-or-update. Retries on EITHER a 23505
    // insert race OR a concurrent-delete-mid-update (`applyUpdate → null`), so the two races can stack
    // across attempts without prematurely hitting the backstop.
    for (let attempt = 0; attempt < MAX_SET_ATTEMPTS; attempt++) {
      try {
        const row = await this.repo.runInTransaction(async (manager) => {
          const existing = await this.repo.findByUserId(userId, manager);
          if (existing) {
            const changedFields = this.diffChangedFields(existing, fields);
            if (changedFields.length === 0) return existing; // no-op: no write, no audit
            const updated = await this.repo.applyUpdate(existing.id, fields, manager);
            if (updated === null) return null; // concurrent delete — re-run the loop → insert
            await this.audit.record(this.entryFor(userId, updated.id, { operation: 'updated', changedFields }), manager);
            return updated;
          }
          const created = await this.repo.createForUser(userId, fields, manager);
          const createdKeys = BENEFICIARY_WRITE_FIELDS.filter((k) => fields[k] !== null);
          await this.audit.record(this.entryFor(userId, created.id, { operation: 'created', changedFields: createdKeys }), manager);
          return created;
        });
        if (row === null) continue; // existing row was deleted mid-update — retry as an insert
        return BeneficiaryResponseDto.build(row, await this.kycStatusOf(userId));
      } catch (err: unknown) {
        if (isUniqueConstraintError(err, UNIQUE_ACTIVE_INDEX) && attempt < MAX_SET_ATTEMPTS - 1) continue;
        throw err;
      }
    }
    // Practically unreachable (see MAX_SET_ATTEMPTS): a single owner would have to lose the race on every
    // attempt. Fail-safe transient backstop — a clean, retryable 503, never a bare 500 or a corrupt state.
    throw new ServiceUnavailableException('Beneficiary is being modified concurrently; please retry.');
  }

  async removeBeneficiary(userId: string): Promise<BeneficiaryResponseDto> {
    await this.repo.runInTransaction(async (manager) => {
      const removedId = await this.repo.deleteByUserId(userId, manager);
      if (removedId === null) return; // idempotent no-op — nothing to remove, nothing to audit
      await this.audit.record(this.entryFor(userId, removedId, { operation: 'removed' }), manager);
    });
    return BeneficiaryResponseDto.build(null, await this.kycStatusOf(userId));
  }

  private normalize(dto: SetBeneficiaryDto): BeneficiaryWriteFields {
    return {
      name: dto.name.trim(),
      email: dto.email.toLowerCase().trim(),
      stellarPubkey: optional(dto.stellarPubkey), // case-sensitive — trim only (optional() never lowercases), blank → null
      relationship: optional(dto.relationship),
      notes: optional(dto.notes),
    };
  }

  /** Keys whose normalized value differs from the stored row (both sides already normalized). */
  private diffChangedFields(existing: Beneficiary, next: BeneficiaryWriteFields): BeneficiaryWriteKey[] {
    return BENEFICIARY_WRITE_FIELDS.filter((k) => (existing[k] ?? null) !== next[k]);
  }

  private entryFor(userId: string, subjectId: string, payload: BeneficiaryAuditPayload): NewAuditEntry {
    return {
      actorType: 'user',
      actorId: userId,
      kind: payload.operation === 'removed' ? AUDIT_KIND.BENEFICIARY_REMOVED : AUDIT_KIND.BENEFICIARY_SET,
      subjectType: 'beneficiary',
      subjectId,
      payload,
    };
  }

  private async kycStatusOf(userId: string): Promise<KycStatus> {
    const row = await this.users.findKycStatusByUserId(userId);
    return row?.kycStatus ?? KycStatus.NOT_SUBMITTED;
  }
}
