import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { ErrorCode } from '@common/enums/error-code.enum';
import { failHttp } from '@common/http/fail-http';
import { assertNever } from '@common/utils/assert-never';
import { isUniqueConstraintError } from '@common/utils/database.utils';
import { IdempotencyStore } from '@common/idempotency/idempotency-store';
import { IStorageService } from '@modules/storage/storage-service.interface';
import { kycConfig } from '@config/kyc.config';
import { User } from '@modules/users/entities/user.entity';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { AUDIT_KIND } from '@modules/wallets/audit/audit-log.types';
import { KycCryptoService } from './crypto/kyc-crypto.service';
import { KycSubmission } from './entities/kyc-submission.entity';
import { KycDocument } from './entities/kyc-document.entity';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { KycSubmissionStatus } from './enums/kyc-submission-status.enum';
import { KycDocType, KYC_REQUIRED_DOC_TYPES } from './enums/kyc-doc-type.enum';
import {
  IKycSubmissionRepository,
  KYC_SUBMISSION_REPOSITORY,
} from './repositories/kyc-submission-repository.interface';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { KycSubmissionResponseDto } from './dto/kyc-submission-response.dto';
import { KycStatusResponseDto } from './dto/kyc-status-response.dto';
import { WhitelistStatusResponseDto } from './dto/whitelist-status-response.dto';
import { ValidatedKycFiles } from './kyc-file.validator';
import { KYC_STORAGE, kycObjectKey } from './kyc.util';

const PENDING_INDEX = 'UQ_kyc_submissions_one_pending_per_user';

/** A fully-populated new `kyc_documents` row (every column known) — tighter than DeepPartial. */
type NewKycDocumentRow = Pick<
  KycDocument,
  | 'submissionId'
  | 'docType'
  | 'storageKey'
  | 'encryptedDek'
  | 'dekKeyVersion'
  | 'blobHash'
  | 'contentType'
  | 'byteSize'
>;

/** Body persisted for an idempotent replay — exactly the 202 shape (this endpoint is its only writer). */
interface SubmitBody {
  submissionId: string;
  status: KycSubmissionStatus;
  kycStatus: KycStatus;
}

/**
 * KYC submission orchestration (TOV-28, FR-01.07). Strict ordering (verify → hash → idempotency →
 * encrypt+upload → short DB transaction), so obvious rejections never touch storage and the transaction
 * holds no network I/O. The encrypted blobs are written to the private bucket BEFORE the DB rows; a DB
 * failure best-effort-deletes them, and the partial-unique index is the durable race backstop.
 */
@Injectable()
export class KycService {
  constructor(
    @Inject(KYC_SUBMISSION_REPOSITORY) private readonly submissions: IKycSubmissionRepository,
    @Inject(KYC_STORAGE) private readonly storage: IStorageService,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly crypto: KycCryptoService,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditLogService,
    @Inject(kycConfig.KEY) private readonly config: ConfigType<typeof kycConfig>,
  ) {}

  async submit(
    userId: string,
    idempotencyKey: string,
    dto: SubmitKycDto,
    files: ValidatedKycFiles,
  ): Promise<KycSubmissionResponseDto> {
    const jurisdiction = dto.claimedJurisdiction; // already trimmed + upper-cased by the DTO
    if (!this.config.jurisdictionAllowlist.includes(jurisdiction)) {
      throw failHttp(
        ErrorCode.JURISDICTION_NOT_ELIGIBLE,
        HttpStatus.UNPROCESSABLE_ENTITY,
        'This jurisdiction is not eligible for KYC at launch',
      );
    }

    // Fingerprint over the KEYED blob hashes (not raw buffers) — cheap, no PII. Order is deterministic
    // because it iterates the fixed KYC_REQUIRED_DOC_TYPES tuple (not JS object-key order in general).
    const hashes = {} as Record<KycDocType, string>;
    for (const docType of KYC_REQUIRED_DOC_TYPES) {
      hashes[docType] = await this.crypto.hashPlaintext(files[docType].buffer);
    }
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(hashes) + '|' + jurisdiction)
      .digest('hex');

    // Idempotency BEFORE the resubmit-policy check, so a legitimate same-key retry replays the original
    // 202 rather than tripping the now-pending status (the first request already flipped it). Exhaustive
    // switch — a future 5th outcome is a compile error, not a silent fall-through to `proceed`.
    const key = `idem:kyc-submit:${userId}:${idempotencyKey}`;
    const begin = await this.idempotency.begin(key, fingerprint);
    switch (begin.outcome) {
      case 'mismatch':
        throw failHttp(
          ErrorCode.IDEMPOTENCY_KEY_MISMATCH,
          HttpStatus.UNPROCESSABLE_ENTITY,
          'Idempotency-Key reused with a different request body',
        );
      case 'in_flight':
        throw failHttp(
          ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT,
          HttpStatus.CONFLICT,
          'A request with this Idempotency-Key is already in progress',
        );
      case 'replay':
        return this.replay(begin.body);
      case 'proceed':
        break;
      default:
        return assertNever(begin);
    }

    const submissionId = this.crypto.deterministicSubmissionId(userId, idempotencyKey);
    const uploaded: string[] = [];
    let docRows: NewKycDocumentRow[] = [];
    try {
      // Advisory fast-path resubmit check (the in-transaction conditional UPDATE is the authoritative
      // guard). Runs after `begin` claimed the key, so any throw below releases it in the catch.
      const user = await this.users.findOne({ where: { id: userId }, select: { id: true, kycStatus: true } });
      if (!user) {
        throw failHttp(ErrorCode.USER_NOT_FOUND, HttpStatus.NOT_FOUND, 'User not found');
      }
      this.assertResubmitAllowed(user.kycStatus);

      // Encrypt + upload the 4 documents concurrently (independent keys; #188). `blob_hash` reuses the
      // fingerprint hash (no second HMAC). `allSettled` so we can clean up whatever DID upload if one fails.
      const results = await Promise.allSettled(
        KYC_REQUIRED_DOC_TYPES.map(async (docType) => {
          const doc = files[docType];
          const storageKey = kycObjectKey(userId, submissionId, docType);
          const enc = await this.crypto.encryptDocument(doc.buffer, `${userId}|${submissionId}|${docType}`);
          await this.storage.upload(storageKey, enc.blob, doc.contentType);
          const row: NewKycDocumentRow = {
            submissionId,
            docType,
            storageKey,
            encryptedDek: enc.wrappedDek.wrapped,
            dekKeyVersion: enc.wrappedDek.keyVersion,
            blobHash: hashes[docType],
            contentType: doc.contentType,
            byteSize: doc.size,
          };
          return { storageKey, row };
        }),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') uploaded.push(r.value.storageKey);
      }
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) {
        throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
      }
      docRows = results.map(
        (r) => (r as PromiseFulfilledResult<{ storageKey: string; row: NewKycDocumentRow }>).value.row,
      );

      await this.submissions.runInTransaction(async (manager) => {
        // Atomic terminal-state guard (DI-M2): only flip from not_submitted (a rejected collector is folded
        // to not_submitted; frozen/removed resubmit rules are deferred to M12). The row lock on this UPDATE
        // serializes concurrent same-user submits; 0 rows ⇒ whitelisted/frozen/removed or already pending.
        const upd = await manager.update(
          User,
          { id: userId, kycStatus: In([KycStatus.NOT_SUBMITTED]) },
          { kycStatus: KycStatus.PENDING_REVIEW },
        );
        if (!upd.affected) {
          const fresh = await manager.getRepository(User).findOne({
            where: { id: userId },
            select: { kycStatus: true },
          });
          throw fresh?.kycStatus === KycStatus.WHITELISTED
            ? failHttp(ErrorCode.KYC_ALREADY_APPROVED, HttpStatus.CONFLICT, 'KYC already whitelisted')
            : failHttp(ErrorCode.KYC_ALREADY_PENDING, HttpStatus.CONFLICT, 'A KYC submission is already pending');
        }

        const submissionRepo = manager.getRepository(KycSubmission);
        // Resolve `supersedes` INSIDE the txn, after the row lock (#197): the caller's latest existing
        // submission, same-user by the `userId` filter, linked only when it was rejected. Consistent under
        // concurrent same-user submits; reads before the new row is inserted.
        const prior = await submissionRepo.findOne({ where: { userId }, order: { createdAt: 'DESC' } });
        const supersedesSubmissionId =
          prior?.status === KycSubmissionStatus.REJECTED ? prior.id : null;
        await submissionRepo.save(
          submissionRepo.create({
            id: submissionId,
            userId,
            status: KycSubmissionStatus.PENDING_REVIEW,
            claimedJurisdiction: jurisdiction,
            supersedesSubmissionId,
          }),
        );

        const documentRepo = manager.getRepository(KycDocument);
        await documentRepo.save(docRows.map((r) => documentRepo.create(r)));

        await this.audit.record(
          {
            actorType: 'user',
            actorId: userId,
            kind: AUDIT_KIND.KYC_SUBMISSION_CREATED,
            subjectType: 'kyc_submission',
            subjectId: submissionId,
            payload: { jurisdiction, docTypes: [...KYC_REQUIRED_DOC_TYPES], docCount: KYC_REQUIRED_DOC_TYPES.length },
          },
          manager,
        );
      });
    } catch (err) {
      await this.cleanup(uploaded);
      await this.idempotency.fail(key, begin.token);
      if (isUniqueConstraintError(err, PENDING_INDEX)) {
        throw failHttp(ErrorCode.KYC_ALREADY_PENDING, HttpStatus.CONFLICT, 'A KYC submission is already pending');
      }
      throw err;
    }

    const body: SubmitBody = {
      submissionId,
      status: KycSubmissionStatus.PENDING_REVIEW,
      kycStatus: KycStatus.PENDING_REVIEW,
    };
    await this.idempotency.complete(key, begin.token, body);
    return KycSubmissionResponseDto.fromEntity(
      { id: submissionId, status: KycSubmissionStatus.PENDING_REVIEW },
      KycStatus.PENDING_REVIEW,
    );
  }

  /** GET /me/kyc — the caller's KYC state (status metadata only; never document bytes/keys). */
  async getStatus(userId: string): Promise<KycStatusResponseDto> {
    const user = await this.users.findOne({ where: { id: userId }, select: { id: true, kycStatus: true } });
    if (!user) {
      throw failHttp(ErrorCode.USER_NOT_FOUND, HttpStatus.NOT_FOUND, 'User not found');
    }
    const latest = await this.submissions.findLatestByUser(userId);
    return KycStatusResponseDto.build(user.kycStatus, latest);
  }

  /**
   * GET /me/kyc/status — the caller's whitelist status card (TOV-29, FR-01.08). Two independent reads
   * (user projection + latest submission), so `status` and `lastSubmissionAt` are eventually-consistent,
   * not a single snapshot — an acceptable, already-tested skew for a read-only card. `id` is selected so an
   * all-null projection can't collapse to `null` (TOV-26 gotcha). Status metadata only — never document
   * bytes/keys/URLs.
   */
  async getWhitelistStatus(userId: string): Promise<WhitelistStatusResponseDto> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, kycStatus: true, whitelistedAt: true, kycReason: true },
    });
    if (!user) {
      throw failHttp(ErrorCode.USER_NOT_FOUND, HttpStatus.NOT_FOUND, 'User not found');
    }
    // NB: the second read is unconditional — `status` and the submission are DECOUPLED axes. A
    // `not_submitted` collector can still have a (rejected) submission after a rejection folds them back,
    // so we cannot skip `findLatestByUser` by status without dropping `lastSubmissionAt` for those users.
    const latest = await this.submissions.findLatestByUser(userId);
    return WhitelistStatusResponseDto.build(user, latest);
  }

  private assertResubmitAllowed(status: KycStatus): void {
    if (status === KycStatus.PENDING_REVIEW) {
      throw failHttp(ErrorCode.KYC_ALREADY_PENDING, HttpStatus.CONFLICT, 'A KYC submission is already pending');
    }
    if (status === KycStatus.WHITELISTED) {
      throw failHttp(ErrorCode.KYC_ALREADY_APPROVED, HttpStatus.CONFLICT, 'KYC already whitelisted');
    }
  }

  /** Best-effort removal of already-uploaded blobs on a failed submit (never masks the root cause). */
  private async cleanup(storageKeys: string[]): Promise<void> {
    await Promise.allSettled(storageKeys.map((k) => this.storage.delete(k)));
  }

  private replay(body: unknown): KycSubmissionResponseDto {
    // This endpoint is the sole writer of the key's body, but it round-trips through Redis + JSON.parse —
    // guard the shape so a corrupt/truncated record fails cleanly instead of yielding a bad 202.
    if (typeof body !== 'object' || body === null || typeof (body as SubmitBody).submissionId !== 'string') {
      throw failHttp(ErrorCode.INTERNAL_ERROR, HttpStatus.INTERNAL_SERVER_ERROR, 'KYC replay body malformed');
    }
    const b = body as SubmitBody;
    return KycSubmissionResponseDto.fromEntity({ id: b.submissionId, status: b.status }, b.kycStatus);
  }
}
