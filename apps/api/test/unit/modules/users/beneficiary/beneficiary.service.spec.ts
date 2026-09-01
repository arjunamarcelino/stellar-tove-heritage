import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EntityManager } from 'typeorm';
import { BeneficiaryService } from '@modules/users/beneficiary/beneficiary.service';
import { Beneficiary } from '@modules/users/beneficiary/entities/beneficiary.entity';
import { SetBeneficiaryDto } from '@modules/users/beneficiary/dto/set-beneficiary.dto';
import { IBeneficiaryRepository } from '@modules/users/beneficiary/repositories/beneficiary-repository.interface';
import { IUserRepository } from '@modules/users/repositories/user-repository.interface';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { AUDIT_KIND } from '@modules/wallets/audit/audit-log.types';
import { KycStatus } from '@common/enums/kyc-status.enum';

const USER = 'user-1';

/** A Beneficiary-shaped row (all normalized fields defaulted to null, timestamps live). */
function fakeBeneficiary(overrides: Partial<Beneficiary> = {}): Beneficiary {
  return {
    id: 'ben-1',
    userId: USER,
    name: 'Jane Doe',
    email: 'jane@example.com',
    stellarPubkey: null,
    relationship: null,
    notes: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

/** A SetBeneficiaryDto body (name+email required; optionals omitted unless overridden). */
function dto(overrides: Partial<SetBeneficiaryDto> = {}): SetBeneficiaryDto {
  return { name: 'Jane Doe', email: 'jane@example.com', ...overrides };
}

/** A Postgres 23505 on the active-per-user partial-unique index. */
const uniqueRace = { code: '23505', constraint: 'UQ_beneficiaries_user_active' };

describe('BeneficiaryService', () => {
  let repo: {
    findByUserId: ReturnType<typeof vi.fn>;
    createForUser: ReturnType<typeof vi.fn>;
    applyUpdate: ReturnType<typeof vi.fn>;
    deleteByUserId: ReturnType<typeof vi.fn>;
    runInTransaction: ReturnType<typeof vi.fn>;
  };
  let users: { findKycStatusByUserId: ReturnType<typeof vi.fn> };
  let audit: { record: ReturnType<typeof vi.fn> };
  let service: BeneficiaryService;

  beforeEach(() => {
    repo = {
      findByUserId: vi.fn(),
      createForUser: vi.fn(),
      applyUpdate: vi.fn(),
      deleteByUserId: vi.fn(),
      // Run the caller's unit-of-work with a throwaway manager.
      runInTransaction: vi
        .fn()
        .mockImplementation((work: (m: EntityManager) => Promise<unknown>) => work({} as EntityManager)),
    };
    users = { findKycStatusByUserId: vi.fn().mockResolvedValue({ kycStatus: KycStatus.NOT_SUBMITTED }) };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    service = new BeneficiaryService(
      repo as unknown as IBeneficiaryRepository,
      users as unknown as IUserRepository,
      audit as unknown as AuditLogService,
    );
  });

  describe('setBeneficiary', () => {
    it('creates when no row exists and audits operation=created with the populated keys', async () => {
      repo.findByUserId.mockResolvedValue(null);
      const created = fakeBeneficiary({
        stellarPubkey: 'GA6HCMKLEHW5ZTIU5C7VXROIMBQ2N7WW6RE3RA6ORQO4CTAJ6DL4KRZ',
        relationship: 'spouse',
        notes: 'primary heir',
      });
      repo.createForUser.mockResolvedValue(created);

      const res = await service.setBeneficiary(
        USER,
        dto({
          stellarPubkey: 'GA6HCMKLEHW5ZTIU5C7VXROIMBQ2N7WW6RE3RA6ORQO4CTAJ6DL4KRZ',
          relationship: 'spouse',
          notes: 'primary heir',
        }),
      );

      expect(repo.createForUser).toHaveBeenCalledOnce();
      expect(repo.applyUpdate).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: AUDIT_KIND.BENEFICIARY_SET,
          actorType: 'user',
          actorId: USER,
          subjectType: 'beneficiary',
          subjectId: 'ben-1',
          payload: {
            operation: 'created',
            changedFields: ['name', 'email', 'stellarPubkey', 'relationship', 'notes'],
          },
        }),
        expect.anything(),
      );
      expect(res.beneficiary?.name).toBe('Jane Doe');
    });

    it('updates an existing row and audits only the differing keys', async () => {
      const existing = fakeBeneficiary({ name: 'Old Name' });
      const updated = fakeBeneficiary({ name: 'New Name' });
      repo.findByUserId.mockResolvedValue(existing);
      repo.applyUpdate.mockResolvedValue(updated);

      const res = await service.setBeneficiary(USER, dto({ name: 'New Name' }));

      expect(repo.applyUpdate).toHaveBeenCalledOnce();
      expect(repo.createForUser).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: AUDIT_KIND.BENEFICIARY_SET,
          actorType: 'user',
          actorId: USER,
          subjectType: 'beneficiary',
          payload: { operation: 'updated', changedFields: ['name'] },
        }),
        expect.anything(),
      );
      expect(res.beneficiary?.name).toBe('New Name');
    });

    it('is a no-op resubmit when the normalized dto matches the stored row (no write, no audit)', async () => {
      const existing = fakeBeneficiary();
      repo.findByUserId.mockResolvedValue(existing);

      const res = await service.setBeneficiary(USER, dto());

      expect(repo.applyUpdate).not.toHaveBeenCalled();
      expect(repo.createForUser).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(res.beneficiary?.id).toBe('ben-1');
    });

    it('clears an optional on full-replace: omitted notes -> null lands in changedFields', async () => {
      const existing = fakeBeneficiary({ notes: 'some note' });
      const updated = fakeBeneficiary({ notes: null });
      repo.findByUserId.mockResolvedValue(existing);
      repo.applyUpdate.mockResolvedValue(updated);

      await service.setBeneficiary(USER, dto()); // notes omitted

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { operation: 'updated', changedFields: ['notes'] },
        }),
        expect.anything(),
      );
    });

    it('retries once on a 23505 unique race and succeeds via the update path', async () => {
      const existing = fakeBeneficiary({ name: 'Old Name' });
      const updated = fakeBeneficiary({ name: 'New Name' });
      repo.findByUserId.mockResolvedValue(existing);
      repo.applyUpdate.mockResolvedValue(updated);
      // First attempt's whole txn throws the unique-violation; second attempt runs the work normally.
      repo.runInTransaction
        .mockRejectedValueOnce(uniqueRace)
        .mockImplementation((work: (m: EntityManager) => Promise<unknown>) => work({} as EntityManager));

      const res = await service.setBeneficiary(USER, dto({ name: 'New Name' }));

      expect(repo.runInTransaction).toHaveBeenCalledTimes(2);
      expect(res.beneficiary?.name).toBe('New Name');
    });

    it('falls through to insert when a concurrent delete makes applyUpdate return null', async () => {
      const existing = fakeBeneficiary({ name: 'Old Name' });
      const created = fakeBeneficiary({ id: 'ben-2', name: 'New Name' });
      // Attempt 0: existing found, but applyUpdate hits 0 rows (concurrent delete) -> null -> loop re-runs.
      // Attempt 1: no row -> insert.
      repo.findByUserId.mockResolvedValueOnce(existing).mockResolvedValueOnce(null);
      repo.applyUpdate.mockResolvedValue(null);
      repo.createForUser.mockResolvedValue(created);

      const res = await service.setBeneficiary(USER, dto({ name: 'New Name' }));

      expect(repo.applyUpdate).toHaveBeenCalledOnce();
      expect(repo.createForUser).toHaveBeenCalledOnce();
      expect(res.beneficiary?.id).toBe('ben-2');
    });

    it('survives a STACKED race (23505 then concurrent-delete) and still succeeds (issue 419)', async () => {
      const existing = fakeBeneficiary({ name: 'Old Name' });
      const created = fakeBeneficiary({ id: 'ben-3', name: 'New Name' });
      // Attempt 0: whole txn throws 23505 (insert race). Attempt 1: existing found but applyUpdate -> null
      // (concurrent delete) -> retry. Attempt 2: no row -> insert succeeds. The old 2-attempt loop threw here.
      repo.findByUserId.mockResolvedValueOnce(existing).mockResolvedValueOnce(null);
      repo.applyUpdate.mockResolvedValue(null);
      repo.createForUser.mockResolvedValue(created);
      repo.runInTransaction
        .mockRejectedValueOnce(uniqueRace)
        .mockImplementation((work: (m: EntityManager) => Promise<unknown>) => work({} as EntityManager));

      const res = await service.setBeneficiary(USER, dto({ name: 'New Name' }));

      expect(repo.runInTransaction).toHaveBeenCalledTimes(3);
      expect(res.beneficiary?.id).toBe('ben-3');
    });
  });

  describe('removeBeneficiary', () => {
    it('deletes an existing row, audits operation=removed, and returns beneficiary=null', async () => {
      repo.deleteByUserId.mockResolvedValue('ben-1');

      const res = await service.removeBeneficiary(USER);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: AUDIT_KIND.BENEFICIARY_REMOVED,
          actorType: 'user',
          actorId: USER,
          subjectType: 'beneficiary',
          subjectId: 'ben-1',
          payload: { operation: 'removed' },
        }),
        expect.anything(),
      );
      expect(res.beneficiary).toBeNull();
    });

    it('is an idempotent no-op when there is nothing to remove (no audit)', async () => {
      repo.deleteByUserId.mockResolvedValue(null);

      const res = await service.removeBeneficiary(USER);

      expect(audit.record).not.toHaveBeenCalled();
      expect(res.beneficiary).toBeNull();
    });
  });

  describe('getBeneficiary', () => {
    it('returns { beneficiary: null, notice: null } for no row + WHITELISTED', async () => {
      repo.findByUserId.mockResolvedValue(null);
      users.findKycStatusByUserId.mockResolvedValue({ kycStatus: KycStatus.WHITELISTED });

      const res = await service.getBeneficiary(USER);

      expect(res.beneficiary).toBeNull();
      expect(res.notice).toBeNull();
    });

    it('returns the beneficiary + KYC_REQUIRED_FOR_TRANSFER notice for a row + NOT_SUBMITTED', async () => {
      repo.findByUserId.mockResolvedValue(fakeBeneficiary());
      users.findKycStatusByUserId.mockResolvedValue({ kycStatus: KycStatus.NOT_SUBMITTED });

      const res = await service.getBeneficiary(USER);

      expect(res.beneficiary?.id).toBe('ben-1');
      expect(res.notice?.code).toBe('KYC_REQUIRED_FOR_TRANSFER');
    });

    it.each([
      [KycStatus.NOT_SUBMITTED, true],
      [KycStatus.PENDING_REVIEW, true],
      [KycStatus.WHITELISTED, false],
      [KycStatus.FROZEN, true],
      [KycStatus.REMOVED, true],
    ] as const)('gates the notice for %s (shown=%s)', async (kycStatus, shown) => {
      repo.findByUserId.mockResolvedValue(fakeBeneficiary());
      users.findKycStatusByUserId.mockResolvedValue({ kycStatus });

      const res = await service.getBeneficiary(USER);

      if (shown) {
        expect(res.notice?.code).toBe('KYC_REQUIRED_FOR_TRANSFER');
      } else {
        expect(res.notice).toBeNull();
      }
    });
  });
});
