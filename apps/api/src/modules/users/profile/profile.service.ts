import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash, randomUUID } from 'node:crypto';
import { failHttp, failValidation } from '@common/http/fail-http';
import { ErrorCode } from '@common/enums/error-code.enum';
import { assertNever } from '@common/utils/assert-never';
import { IdempotencyStore } from '@common/idempotency/idempotency-store';
import { profileImageConfig } from '@config/profile-image.config';
import { IProfileStorageService } from '@modules/storage/storage-service.interface';
import { USER_REPOSITORY, IUserRepository } from '../repositories/user-repository.interface';
import {
  PROFILE_IMAGE_REPOSITORY,
  IProfileImageRepository,
} from './repositories/profile-image-repository.interface';
import { ProfileImage } from './entities/profile-image.entity';
import { ProfileViewService } from './profile-view.service';
import { ProfilePatch } from './profile.types';
import { validateAndBuildPatch } from './profile-validation';
import { probeUpload } from './profile-image.probe';
import { MeProfileResponseDto } from './dto/me-profile-response.dto';
import { ProfileImageUploadResponseDto } from './dto/profile-image-upload-response.dto';
import { ProfileImageCommitResponseDto } from './dto/commit-profile-image.dto';
import { ProfileImageStatusResponseDto } from './dto/profile-image-status-response.dto';
import {
  PROFILE_SOURCE_STORAGE,
  PROFILE_PUBLIC_STORAGE,
  PROFILE_DERIVATIVE_QUEUE,
  PROFILE_DERIVE_JOB,
  PROFILE_DERIVE_JOB_OPTS,
  PROFILE_DERIVATIVE_SPECS,
  PROFILE_MAX_INFLIGHT_IMAGES,
  ProfileDeriveJob,
  profileDeriveJobId,
  profileSourcePath,
  profilePrivateDerivativePath,
  profilePublicDerivativePath,
} from './constants/profile-image.constants';

/**
 * Profile fields + avatar orchestration (TOV-30). PATCH validates the raw body → 422; image endpoints are
 * idempotency-keyed (mirrors rfqs/kyc). Derivatives publish to the public bucket only on ACTIVATION; a new
 * avatar / removal / delete purges the prior public copies.
 */
@Injectable()
export class ProfileService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(PROFILE_IMAGE_REPOSITORY) private readonly images: IProfileImageRepository,
    @Inject(PROFILE_SOURCE_STORAGE) private readonly sourceStorage: IProfileStorageService,
    @Inject(PROFILE_PUBLIC_STORAGE) private readonly publicStorage: IProfileStorageService,
    private readonly idempotency: IdempotencyStore,
    @InjectQueue(PROFILE_DERIVATIVE_QUEUE) private readonly deriveQueue: Queue<ProfileDeriveJob>,
    @Inject(profileImageConfig.KEY) private readonly cfg: ConfigType<typeof profileImageConfig>,
    private readonly view: ProfileViewService,
  ) {}

  getMyProfile(userId: string): Promise<MeProfileResponseDto> {
    return this.view.buildForUser(userId);
  }

  async updateProfile(userId: string, body: Record<string, unknown>): Promise<MeProfileResponseDto> {
    const { patch, errors } = validateAndBuildPatch(body);
    if (errors.length > 0) throw failValidation(errors);

    const profile = await this.users.findProfileFieldsByUserId(userId);
    if (!profile) throw failHttp(ErrorCode.USER_NOT_FOUND, HttpStatus.NOT_FOUND, 'User not found');
    const priorImageId = profile.profileImageId;

    const activateId = 'profileImageId' in patch && patch.profileImageId != null ? patch.profileImageId : null;

    // Apply the text/social fields (and a `profileImageId: null` clear). A NON-null activation goes through
    // the guarded `activateAvatar` below instead, so it's excluded from this column-scoped write.
    const fieldPatch: ProfilePatch = {};
    if ('bio' in patch) fieldPatch.bio = patch.bio;
    if ('statement' in patch) fieldPatch.statement = patch.statement;
    if ('socialLinks' in patch) fieldPatch.socialLinks = patch.socialLinks;
    if ('profileImageId' in patch && activateId === null) fieldPatch.profileImageId = patch.profileImageId;
    if (Object.keys(fieldPatch).length > 0) await this.users.updateProfileFields(userId, fieldPatch);

    // Activation: gate on ready + ownership, publish derivatives to the public bucket, then set the FK
    // CONDITIONALLY (still ready + not soft-deleted) so a concurrent delete can't leave a dangling avatar.
    if (activateId !== null) {
      const img = await this.images.findOwned(activateId, userId);
      if (!img) throw failHttp(ErrorCode.PROFILE_IMAGE_NOT_FOUND, HttpStatus.NOT_FOUND, 'Image not found');
      if (img.status !== 'ready') {
        throw failHttp(ErrorCode.PROFILE_IMAGE_NOT_READY, HttpStatus.UNPROCESSABLE_ENTITY, 'Image not ready');
      }
      await this.publishActive(img);
      const activated = await this.users.activateAvatar(userId, activateId);
      if (!activated) {
        // Lost a race with a concurrent delete/retire of this image.
        throw failHttp(ErrorCode.PROFILE_IMAGE_NOT_READY, HttpStatus.UNPROCESSABLE_ENTITY, 'Image not ready');
      }
    }

    // Retire the previously-active image when the avatar changed or was removed: soft-delete the row +
    // purge its public AND private blobs (bounds per-user storage growth — superseded images aren't kept).
    if ('profileImageId' in patch) {
      const newId = patch.profileImageId ?? null;
      if (priorImageId && priorImageId !== newId) await this.retireImage(userId, priorImageId);
    }

    return this.view.buildForUser(userId);
  }

  async requestUpload(userId: string, idempotencyKey: string): Promise<ProfileImageUploadResponseDto> {
    const key = `idem:profile-image:${userId}:${idempotencyKey}`;
    const fingerprint = createHash('sha256').update('request-upload').digest('hex');
    const begin = await this.idempotency.begin(key, fingerprint);
    switch (begin.outcome) {
      case 'mismatch':
        throw failHttp(ErrorCode.IDEMPOTENCY_KEY_MISMATCH, HttpStatus.UNPROCESSABLE_ENTITY, 'Idempotency-Key reused with a different request');
      case 'in_flight':
        throw failHttp(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT, HttpStatus.CONFLICT, 'A request with this Idempotency-Key is already in progress');
      case 'replay':
        return begin.body as ProfileImageUploadResponseDto;
      case 'proceed':
        break;
      default:
        return assertNever(begin);
    }

    const { token } = begin;
    let body: ProfileImageUploadResponseDto;
    try {
      const inflight = await this.images.countNonTerminalByUser(userId);
      if (inflight >= PROFILE_MAX_INFLIGHT_IMAGES) {
        throw failHttp(ErrorCode.PROFILE_TOO_MANY_UPLOADS, HttpStatus.CONFLICT, 'Too many pending uploads; finish or wait for cleanup');
      }
      const imageId = randomUUID();
      const sourcePath = profileSourcePath(userId, imageId);
      await this.images.createPending(userId, imageId, sourcePath);
      const signed = await this.sourceStorage.createSignedUploadUrl(sourcePath);
      body = {
        profileImageId: imageId,
        upload: {
          method: 'PUT',
          url: signed.signedUrl,
          token: signed.token,
          path: signed.path,
          headers: { 'x-upsert': 'false' },
        },
      };
    } catch (err) {
      await this.idempotency.fail(key, token);
      throw err;
    }
    await this.idempotency.complete(key, token, body);
    return body;
  }

  async commitUpload(
    userId: string,
    profileImageId: string,
    idempotencyKey: string,
  ): Promise<ProfileImageCommitResponseDto> {
    const key = `idem:profile-image-commit:${userId}:${idempotencyKey}`;
    const fingerprint = createHash('sha256').update(profileImageId).digest('hex');
    const begin = await this.idempotency.begin(key, fingerprint);
    switch (begin.outcome) {
      case 'mismatch':
        throw failHttp(ErrorCode.IDEMPOTENCY_KEY_MISMATCH, HttpStatus.UNPROCESSABLE_ENTITY, 'Idempotency-Key reused with a different request');
      case 'in_flight':
        throw failHttp(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT, HttpStatus.CONFLICT, 'A request with this Idempotency-Key is already in progress');
      case 'replay':
        return begin.body as ProfileImageCommitResponseDto;
      case 'proceed':
        break;
      default:
        return assertNever(begin);
    }

    const { token } = begin;
    let body: ProfileImageCommitResponseDto;
    try {
      const img = await this.images.findOwned(profileImageId, userId);
      if (!img) throw failHttp(ErrorCode.PROFILE_IMAGE_NOT_FOUND, HttpStatus.NOT_FOUND, 'Image not found');
      if (img.status !== 'pending') {
        throw failHttp(ErrorCode.PROFILE_IMAGE_ALREADY_COMMITTED, HttpStatus.CONFLICT, 'Image already committed');
      }

      // Size gate BEFORE download (metadata only): reject an oversized object without streaming it into
      // memory. null ⇒ the client never uploaded. This bounds the download that follows.
      const size = await this.sourceStorage.objectSize(img.sourcePath);
      if (size === null) {
        throw failHttp(ErrorCode.PROFILE_UPLOAD_MISSING, HttpStatus.UNPROCESSABLE_ENTITY, 'No uploaded bytes to commit');
      }
      if (size > this.cfg.maxBytes) {
        await this.images.markFailed(img.id);
        throw failHttp(ErrorCode.PROFILE_IMAGE_TOO_LARGE, HttpStatus.UNPROCESSABLE_ENTITY, 'Image exceeds the size limit');
      }

      const buffer = await this.downloadSource(img.sourcePath);
      const outcome = await probeUpload(buffer, this.cfg.maxBytes);
      if (outcome === 'too_large') {
        await this.images.markFailed(img.id);
        throw failHttp(ErrorCode.PROFILE_IMAGE_TOO_LARGE, HttpStatus.UNPROCESSABLE_ENTITY, 'Image exceeds the size limit');
      }
      if (outcome === 'invalid') {
        await this.images.markFailed(img.id);
        throw failHttp(ErrorCode.PROFILE_IMAGE_INVALID, HttpStatus.UNPROCESSABLE_ENTITY, 'Uploaded file is not a supported image');
      }

      // Atomic pending → processing (the double-commit guard). 0 rows ⇒ another commit won the race.
      const claimed = await this.images.claimForProcessing(img.id, userId);
      if (!claimed) {
        throw failHttp(ErrorCode.PROFILE_IMAGE_ALREADY_COMMITTED, HttpStatus.CONFLICT, 'Image already committed');
      }

      await this.deriveQueue.add(
        PROFILE_DERIVE_JOB,
        { profileImageId: img.id },
        { jobId: profileDeriveJobId(img.id), ...PROFILE_DERIVE_JOB_OPTS },
      );
      body = { profileImageId: img.id, status: 'processing' };
    } catch (err) {
      await this.idempotency.fail(key, token);
      throw err;
    }
    await this.idempotency.complete(key, token, body);
    return body;
  }

  async getImageStatus(userId: string, id: string): Promise<ProfileImageStatusResponseDto> {
    const img = await this.images.findOwned(id, userId);
    if (!img) throw failHttp(ErrorCode.PROFILE_IMAGE_NOT_FOUND, HttpStatus.NOT_FOUND, 'Image not found');
    // Report the real DB status. The reconcile job is the single authoritative terminator for a stuck
    // `processing` row (re-drive then fail); the FE bounds its own poll with a client-side timeout (see the
    // FE contract). A display-only derivation here would contradict a row reconcile is still re-driving.
    return { id: img.id, status: img.status };
  }

  async deleteImage(userId: string, id: string): Promise<void> {
    // Atomic: soft-delete the image AND null the FK if it was the active avatar, in one transaction.
    const existed = await this.images.softDeleteAndClearAvatar(userId, id);
    if (!existed) throw failHttp(ErrorCode.PROFILE_IMAGE_NOT_FOUND, HttpStatus.NOT_FOUND, 'Image not found');

    // Purge blobs (best-effort; delete never throws — a no-op for an image that was never activated/derived).
    await this.unpublishImage(id);
    await this.purgePrivate(userId, id);
  }

  /**
   * Download the private source. Existence was already confirmed by the `objectSize` gate in the caller, so
   * a failure here is a TRANSIENT storage error (5xx/timeout) → 503, not a client fault. Distinguishing this
   * from "never uploaded" (which the size gate catches as 422 MISSING) avoids masking a storage outage.
   */
  private async downloadSource(sourcePath: string): Promise<Buffer> {
    try {
      return await this.sourceStorage.download(sourcePath);
    } catch {
      throw failHttp(ErrorCode.PROFILE_STORAGE_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE, 'Storage temporarily unavailable');
    }
  }

  /** Copy the private derivatives → public bucket (activation). Idempotent (upsert). The 3 copies are
   * independent, so run them in parallel (bounded fan-out of 3) to keep PATCH latency down. */
  private async publishActive(img: ProfileImage): Promise<void> {
    await Promise.all(
      PROFILE_DERIVATIVE_SPECS.map(async ([, size]) => {
        const buf = await this.sourceStorage.download(profilePrivateDerivativePath(img.id, size));
        await this.publicStorage.upload(profilePublicDerivativePath(img.id, size), buf, 'image/webp', {
          upsert: true,
        });
      }),
    );
  }

  /** Delete an image's public derivative copies (best-effort; delete never throws). */
  private async unpublishImage(imageId: string): Promise<void> {
    for (const [, size] of PROFILE_DERIVATIVE_SPECS) {
      await this.publicStorage.delete(profilePublicDerivativePath(imageId, size));
    }
  }

  /** Delete an image's private source + private derivatives (best-effort). Path is deterministic from ids. */
  private async purgePrivate(userId: string, imageId: string): Promise<void> {
    await this.sourceStorage.delete(profileSourcePath(userId, imageId));
    for (const [, size] of PROFILE_DERIVATIVE_SPECS) {
      await this.sourceStorage.delete(profilePrivateDerivativePath(imageId, size));
    }
  }

  /** Retire a superseded image: soft-delete the row + purge its public and private blobs (best-effort). */
  private async retireImage(userId: string, imageId: string): Promise<void> {
    await this.images.softDeleteOwned(imageId, userId);
    await this.unpublishImage(imageId);
    await this.purgePrivate(userId, imageId);
  }
}
