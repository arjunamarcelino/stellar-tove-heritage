import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { KycService } from '@modules/kyc/kyc.service';
import { KycCryptoService } from '@modules/kyc/crypto/kyc-crypto.service';
import { IdempotencyStore } from '@common/idempotency/idempotency-store';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { KYC_SUBMISSION_REPOSITORY } from '@modules/kyc/repositories/kyc-submission-repository.interface';
import { KYC_STORAGE } from '@modules/kyc/kyc.util';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { KycDocType } from '@modules/kyc/enums/kyc-doc-type.enum';
import { kycConfig } from '@config/kyc.config';
import { User } from '@modules/users/entities/user.entity';
import type { SubmitKycDto } from '@modules/kyc/dto/submit-kyc.dto';
import type { ValidatedKycFiles } from '@modules/kyc/kyc-file.validator';

const HEX64 = 'a'.repeat(64);

function makeFiles(): ValidatedKycFiles {
  return {
    [KycDocType.GOV_ID_FRONT]: { buffer: Buffer.from('1'), contentType: 'image/jpeg', size: 1 },
    [KycDocType.GOV_ID_BACK]: { buffer: Buffer.from('2'), contentType: 'image/png', size: 1 },
    [KycDocType.PROOF_OF_ADDRESS]: { buffer: Buffer.from('3'), contentType: 'application/pdf', size: 1 },
    [KycDocType.SELFIE]: { buffer: Buffer.from('4'), contentType: 'image/jpeg', size: 1 },
  };
}

const DTO: SubmitKycDto = { claimedJurisdiction: 'GB' };

describe('KycService', () => {
  let service: KycService;
  let submissions: { findLatestByUser: Mock; runInTransaction: Mock };
  let storage: { upload: Mock; delete: Mock };
  let users: { findOne: Mock };
  let crypto: { hashPlaintext: Mock; encryptDocument: Mock; deterministicSubmissionId: Mock };
  let idempotency: { begin: Mock; complete: Mock; fail: Mock };
  let audit: { record: Mock };
  let manager: { update: Mock; getRepository: Mock };

  beforeEach(async () => {
    manager = {
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      getRepository: vi.fn(() => ({
        create: (x: unknown) => x,
        save: vi.fn().mockResolvedValue(undefined),
        findOne: vi.fn().mockResolvedValue({ kycStatus: KycStatus.NOT_SUBMITTED }),
      })),
    };
    submissions = {
      findLatestByUser: vi.fn().mockResolvedValue(null),
      runInTransaction: vi.fn((work: (m: typeof manager) => Promise<unknown>) => work(manager)),
    };
    storage = { upload: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) };
    users = { findOne: vi.fn().mockResolvedValue({ id: 'u1', kycStatus: KycStatus.NOT_SUBMITTED }) };
    crypto = {
      hashPlaintext: vi.fn().mockReturnValue(HEX64),
      encryptDocument: vi.fn().mockResolvedValue({
        blob: Buffer.from('blob'),
        wrappedDek: { wrapped: Buffer.alloc(60), keyVersion: 1 },
        blobHash: HEX64,
      }),
      deterministicSubmissionId: vi.fn().mockReturnValue('11111111-1111-5111-8111-111111111111'),
    };
    idempotency = {
      begin: vi.fn().mockResolvedValue({ outcome: 'proceed', token: 'tok' }),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
    };
    audit = { record: vi.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycService,
        { provide: KYC_SUBMISSION_REPOSITORY, useValue: submissions },
        { provide: KYC_STORAGE, useValue: storage },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: KycCryptoService, useValue: crypto },
        { provide: IdempotencyStore, useValue: idempotency },
        { provide: AuditLogService, useValue: audit },
        { provide: kycConfig.KEY, useValue: { jurisdictionAllowlist: ['GB', 'US', 'SG'] } },
      ],
    }).compile();
    service = module.get(KycService);
  });

  const submit = (over: Partial<SubmitKycDto> = {}) =>
    service.submit('u1', 'idem-1', { ...DTO, ...over }, makeFiles());

  it('happy path: encrypts+uploads 4, flips status in the txn, audits, completes idempotency, returns 202 body', async () => {
    const res = await submit();
    expect(typeof res.submissionId).toBe('string');
    expect(res.status).toBe('pending_review');
    expect(res.kycStatus).toBe('pending_review');
    expect(storage.upload).toHaveBeenCalledTimes(4);
    expect(manager.update).toHaveBeenCalledTimes(1); // conditional status flip
    // audit written INSIDE the txn (manager passed) with a PII-free payload (exactly these 3 keys — no hashes/bytes)
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'kyc.submission.created',
        subjectType: 'kyc_submission',
        payload: {
          jurisdiction: 'GB',
          docTypes: ['gov_id_front', 'gov_id_back', 'proof_of_address', 'selfie'],
          docCount: 4,
        },
      }),
      manager,
    );
    expect(idempotency.complete).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-allowlisted jurisdiction (422) before any idempotency/upload', async () => {
    await expect(submit({ claimedJurisdiction: 'KP' })).rejects.toMatchObject({
      status: 422,
      response: { errorCode: 'JURISDICTION_NOT_ELIGIBLE' },
    });
    expect(idempotency.begin).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects a resubmission while pending (409) and releases the idempotency key', async () => {
    users.findOne.mockResolvedValue({ id: 'u1', kycStatus: KycStatus.PENDING_REVIEW });
    await expect(submit()).rejects.toMatchObject({ status: 409, response: { errorCode: 'KYC_ALREADY_PENDING' } });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(idempotency.fail).toHaveBeenCalledWith('idem:kyc-submit:u1:idem-1', 'tok');
  });

  it('rejects a resubmission while whitelisted (409 KYC_ALREADY_APPROVED)', async () => {
    users.findOne.mockResolvedValue({ id: 'u1', kycStatus: KycStatus.WHITELISTED });
    await expect(submit()).rejects.toMatchObject({ status: 409, response: { errorCode: 'KYC_ALREADY_APPROVED' } });
  });

  it('allows a resubmission when not_submitted, e.g. after a prior rejection folded back (supersedes resolved in the txn)', async () => {
    users.findOne.mockResolvedValue({ id: 'u1', kycStatus: KycStatus.NOT_SUBMITTED });
    await submit();
    expect(storage.upload).toHaveBeenCalledTimes(4);
    expect(submissions.runInTransaction).toHaveBeenCalledTimes(1);
  });

  it('maps an Idempotency-Key mismatch to 422', async () => {
    idempotency.begin.mockResolvedValue({ outcome: 'mismatch' });
    await expect(submit()).rejects.toMatchObject({ status: 422, response: { errorCode: 'IDEMPOTENCY_KEY_MISMATCH' } });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('maps an in-flight Idempotency-Key to 409', async () => {
    idempotency.begin.mockResolvedValue({ outcome: 'in_flight' });
    await expect(submit()).rejects.toMatchObject({ status: 409, response: { errorCode: 'IDEMPOTENCY_KEY_IN_FLIGHT' } });
  });

  it('replays the stored 202 body without re-uploading', async () => {
    idempotency.begin.mockResolvedValue({
      outcome: 'replay',
      body: { submissionId: 'orig', status: 'pending_review', kycStatus: 'pending_review' },
    });
    const res = await submit();
    expect(res.submissionId).toBe('orig');
    expect(storage.upload).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
  });

  it('remaps a 23505 on the pending index to 409 and cleans up uploaded blobs', async () => {
    submissions.runInTransaction.mockRejectedValue({
      code: '23505',
      constraint: 'UQ_kyc_submissions_one_pending_per_user',
    });
    await expect(submit()).rejects.toMatchObject({ status: 409, response: { errorCode: 'KYC_ALREADY_PENDING' } });
    expect(storage.delete).toHaveBeenCalledTimes(4); // best-effort cleanup of the 4 uploaded blobs
    expect(idempotency.fail).toHaveBeenCalled();
  });

  it('on a generic DB failure: cleans up, releases the key, and rethrows the original error', async () => {
    const boom = new Error('db down');
    submissions.runInTransaction.mockRejectedValue(boom);
    await expect(submit()).rejects.toBe(boom);
    expect(storage.delete).toHaveBeenCalledTimes(4);
    expect(idempotency.fail).toHaveBeenCalled();
  });

  it('on an upload failure (parallel): cleans up the blobs that DID upload, never opens the txn', async () => {
    storage.upload.mockRejectedValueOnce(new Error('storage 503')); // 1 of 4 fails; the other 3 upload
    await expect(submit()).rejects.toThrow('storage 503');
    expect(storage.delete).toHaveBeenCalledTimes(3); // the 3 successful uploads are cleaned up
    expect(submissions.runInTransaction).not.toHaveBeenCalled();
    expect(idempotency.fail).toHaveBeenCalled();
  });

  describe('getStatus', () => {
    it('returns status + latest submission', async () => {
      users.findOne.mockResolvedValue({ id: 'u1', kycStatus: KycStatus.PENDING_REVIEW });
      submissions.findLatestByUser.mockResolvedValue({
        id: 's1',
        status: 'pending_review',
        claimedJurisdiction: 'GB',
        createdAt: new Date('2026-07-16T00:00:00Z'),
      });
      const res = await service.getStatus('u1');
      expect(res.kycStatus).toBe('pending_review');
      expect(res.latestSubmission).toMatchObject({ submissionId: 's1', claimedJurisdiction: 'GB' });
    });

    it('404s when the user row is gone', async () => {
      users.findOne.mockResolvedValue(null);
      await expect(service.getStatus('u1')).rejects.toMatchObject({ status: 404, response: { errorCode: 'USER_NOT_FOUND' } });
    });
  });

  describe('getWhitelistStatus', () => {
    it('maps the whitelist state + wires the latest submission timestamp', async () => {
      users.findOne.mockResolvedValue({
        id: 'u1',
        kycStatus: KycStatus.WHITELISTED,
        whitelistedAt: new Date('2026-07-17T10:00:00Z'),
        kycReason: null,
      });
      submissions.findLatestByUser.mockResolvedValue({ createdAt: new Date('2026-07-15T09:00:00Z') });
      const res = await service.getWhitelistStatus('u1');
      expect(res).toEqual({
        status: 'whitelisted',
        whitelistedAt: '2026-07-17T10:00:00.000Z',
        reason: null,
        lastSubmissionAt: '2026-07-15T09:00:00.000Z',
      });
    });

    it('gates frozen: surfaces the reason code, never a stale whitelistedAt', async () => {
      users.findOne.mockResolvedValue({
        id: 'u1',
        kycStatus: KycStatus.FROZEN,
        whitelistedAt: new Date('2026-07-01T00:00:00Z'),
        kycReason: 'frozen_compliance_review',
      });
      submissions.findLatestByUser.mockResolvedValue(null);
      const res = await service.getWhitelistStatus('u1');
      expect(res).toMatchObject({ status: 'frozen', reason: 'frozen_compliance_review', whitelistedAt: null });
    });

    it('404s when the user row is gone', async () => {
      users.findOne.mockResolvedValue(null);
      await expect(service.getWhitelistStatus('u1')).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'USER_NOT_FOUND' },
      });
    });
  });
});
