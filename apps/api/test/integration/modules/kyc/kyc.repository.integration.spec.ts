import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Module } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createTestingModule, truncateTables } from '../../setup';
import { User } from '@modules/users/entities/user.entity';
import { KycSubmission } from '@modules/kyc/entities/kyc-submission.entity';
import { KycDocument } from '@modules/kyc/entities/kyc-document.entity';
import { KycSubmissionRepository } from '@modules/kyc/repositories/kyc-submission.repository';
import { KYC_SUBMISSION_REPOSITORY } from '@modules/kyc/repositories/kyc-submission-repository.interface';
import type { IKycSubmissionRepository } from '@modules/kyc/repositories/kyc-submission-repository.interface';
import { KycSubmissionStatus } from '@modules/kyc/enums/kyc-submission-status.enum';
import { KycDocType, KYC_REQUIRED_DOC_TYPES } from '@modules/kyc/enums/kyc-doc-type.enum';
import { isUniqueConstraintError } from '@common/utils/database.utils';

@Module({
  imports: [TypeOrmModule.forFeature([KycSubmission, KycDocument, User])],
  providers: [{ provide: KYC_SUBMISSION_REPOSITORY, useClass: KycSubmissionRepository }],
})
class TestKycModule {}

describe('KYC Repositories Integration', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let submissionRepo: IKycSubmissionRepository;

  beforeAll(async () => {
    module = await createTestingModule(TestKycModule);
    dataSource = module.get(DataSource);
    submissionRepo = module.get(KYC_SUBMISSION_REPOSITORY);
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
  });

  /** Insert a user via raw SQL (satisfies the kyc_submissions FK) and return its id. */
  async function createUser(email: string): Promise<string> {
    const rows: { id: string }[] = await dataSource.query(
      `INSERT INTO users (email, is_active, kyc_status) VALUES ($1, true, 'not_submitted') RETURNING id`,
      [email],
    );
    return rows[0].id;
  }

  /** A valid kyc_document payload for one doc type — all at-rest CHECKs satisfied. */
  function buildDocument(submissionId: string, docType: KycDocType): Partial<KycDocument> {
    return {
      submissionId,
      docType,
      storageKey: `user/${submissionId}/${docType}`,
      encryptedDek: Buffer.alloc(60), // CHK_kyc_documents_dek_len: exactly 60 bytes
      dekKeyVersion: 1, // CHK_kyc_documents_dek_version: >= 1
      blobHash: 'a'.repeat(64), // CHK_kyc_documents_blob_hash: ^[0-9a-f]{64}$
      contentType: 'image/jpeg', // CHK_kyc_documents_content_type
      byteSize: 1024, // CHK_kyc_documents_byte_size: 1..10485760
    };
  }

  it('persists a submission + its four documents inside one transaction', async () => {
    const userId = await createUser('u1@example.com');

    const submissionId = await submissionRepo.runInTransaction(async (manager) => {
      const submission = await manager.getRepository(KycSubmission).save(
        manager.getRepository(KycSubmission).create({
          userId,
          status: KycSubmissionStatus.PENDING_REVIEW,
          claimedJurisdiction: 'GB',
        }),
      );

      await manager
        .getRepository(KycDocument)
        .save(KYC_REQUIRED_DOC_TYPES.map((docType) => buildDocument(submission.id, docType)));

      return submission.id;
    });

    const subRows: { count: number }[] = await dataSource.query(
      `SELECT count(*)::int AS count FROM kyc_submissions WHERE id = $1`,
      [submissionId],
    );
    expect(subRows[0].count).toBe(1);

    const docRows: { count: number }[] = await dataSource.query(
      `SELECT count(*)::int AS count FROM kyc_documents WHERE submission_id = $1`,
      [submissionId],
    );
    expect(docRows[0].count).toBe(4);
  });

  it('a soft-deleted pending submission releases the pending slot (partial index excludes deleted rows)', async () => {
    const userId = await createUser('u2@example.com');

    const first = await submissionRepo.save(
      submissionRepo.create({
        userId,
        status: KycSubmissionStatus.PENDING_REVIEW,
        claimedJurisdiction: 'GB',
      }),
    );
    await submissionRepo.softRemove(first);

    // A new pending insert now succeeds — the partial-unique index only covers live pending rows.
    await expect(
      dataSource.query(
        `INSERT INTO kyc_submissions (user_id, status, claimed_jurisdiction) VALUES ($1, 'pending_review', 'GB')`,
        [userId],
      ),
    ).resolves.toBeDefined();
  });

  it('findLatestByUser returns the newest submission first', async () => {
    const userId = await createUser('u4@example.com');

    const older = await submissionRepo.save(
      submissionRepo.create({
        userId,
        status: KycSubmissionStatus.REJECTED,
        claimedJurisdiction: 'GB',
      }),
    );
    // Nudge the timestamps apart so DESC ordering is unambiguous.
    await dataSource.query(
      `UPDATE kyc_submissions SET created_at = now() - interval '1 hour' WHERE id = $1`,
      [older.id],
    );

    const newer = await submissionRepo.save(
      submissionRepo.create({
        userId,
        status: KycSubmissionStatus.PENDING_REVIEW,
        claimedJurisdiction: 'FR',
      }),
    );

    const latest = await submissionRepo.findLatestByUser(userId);
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(newer.id);
  });

  it('rejects a second pending submission for the same user (partial-unique race)', async () => {
    const userId = await createUser('u5@example.com');

    await dataSource.query(
      `INSERT INTO kyc_submissions (user_id, status, claimed_jurisdiction) VALUES ($1, 'pending_review', 'GB')`,
      [userId],
    );

    let caught: unknown;
    try {
      await dataSource.query(
        `INSERT INTO kyc_submissions (user_id, status, claimed_jurisdiction) VALUES ($1, 'pending_review', 'GB')`,
        [userId],
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(isUniqueConstraintError(caught, 'UQ_kyc_submissions_one_pending_per_user')).toBe(true);
  });

  it('allows a rejected submission to coexist with a pending one', async () => {
    const userId = await createUser('u6@example.com');

    await dataSource.query(
      `INSERT INTO kyc_submissions (user_id, status, claimed_jurisdiction) VALUES ($1, 'pending_review', 'GB')`,
      [userId],
    );
    // A rejected row must NOT trip the pending-only partial index.
    await expect(
      dataSource.query(
        `INSERT INTO kyc_submissions (user_id, status, claimed_jurisdiction) VALUES ($1, 'rejected', 'GB')`,
        [userId],
      ),
    ).resolves.toBeDefined();

    const rows: { count: number }[] = await dataSource.query(
      `SELECT count(*)::int AS count FROM kyc_submissions WHERE user_id = $1`,
      [userId],
    );
    expect(rows[0].count).toBe(2);
  });

  it('FK is ON DELETE RESTRICT: hard-deleting a submission with documents rejects', async () => {
    const userId = await createUser('u7@example.com');

    const submission = await submissionRepo.save(
      submissionRepo.create({
        userId,
        status: KycSubmissionStatus.PENDING_REVIEW,
        claimedJurisdiction: 'GB',
      }),
    );
    await dataSource.getRepository(KycDocument).save(buildDocument(submission.id, KycDocType.SELFIE));

    await expect(
      dataSource.query(`DELETE FROM kyc_submissions WHERE id = $1`, [submission.id]),
    ).rejects.toThrow();
  });

  it('at-rest CHECK rejects a document with a non-hex blob_hash', async () => {
    const userId = await createUser('u8@example.com');

    const submission = await submissionRepo.save(
      submissionRepo.create({
        userId,
        status: KycSubmissionStatus.PENDING_REVIEW,
        claimedJurisdiction: 'GB',
      }),
    );

    await expect(
      dataSource.query(
        `INSERT INTO kyc_documents
           (submission_id, doc_type, storage_key, encrypted_dek, dek_key_version, blob_hash, content_type, byte_size)
         VALUES ($1, 'selfie', 'k', $2, 1, $3, 'image/jpeg', 1024)`,
        [submission.id, Buffer.alloc(60), 'NOTHEX'],
      ),
    ).rejects.toThrow();
  });
});
