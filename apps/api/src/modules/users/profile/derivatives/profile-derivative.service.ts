import { Inject, Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { IProfileStorageService } from '@modules/storage/storage-service.interface';
import {
  PROFILE_IMAGE_REPOSITORY,
  IProfileImageRepository,
} from '../repositories/profile-image-repository.interface';
import {
  PROFILE_SOURCE_STORAGE,
  PROFILE_DERIVATIVE_SPECS,
  PROFILE_WEBP_QUALITY,
  PROFILE_SHARP_INPUT_OPTS,
  ProfileImageDerivatives,
  profilePrivateDerivativePath,
} from '../constants/profile-image.constants';

/** Deterministic (invalid-image) derivative failure — the processor maps it to a non-retryable job. */
export class ProfileDeriveTerminalError extends Error {}

// One libvips thread per pipeline (the worker already runs jobs concurrently) + no operation cache (a
// one-shot worker gets no reuse benefit, only RSS growth). Set once at module load.
sharp.concurrency(1);
sharp.cache(false);

const LARGEST_SIZE = Math.max(...PROFILE_DERIVATIVE_SPECS.map(([, size]) => size));

/**
 * Generates the 64/256/512 webp avatar derivatives from the private source (TOV-30). Decodes ONCE at the
 * largest target (keeps libvips shrink-on-load), then clones down — best CPU/memory trade-off. Writes the
 * derivatives to the PRIVATE bucket; activation later copies the active one to the public bucket. Idempotent:
 * re-running overwrites (upsert) and a row already `ready` is a no-op.
 */
@Injectable()
export class ProfileDerivativeService {
  private readonly logger = new Logger(ProfileDerivativeService.name);

  constructor(
    @Inject(PROFILE_IMAGE_REPOSITORY) private readonly images: IProfileImageRepository,
    @Inject(PROFILE_SOURCE_STORAGE) private readonly sourceStorage: IProfileStorageService,
  ) {}

  async generate(profileImageId: string): Promise<void> {
    const img = await this.images.findById(profileImageId);
    if (!img) throw new ProfileDeriveTerminalError(`profile image ${profileImageId} not found`);
    if (img.status === 'ready') return; // idempotent no-op
    if (img.status !== 'processing') {
      throw new ProfileDeriveTerminalError(`profile image ${profileImageId} not in processing (${img.status})`);
    }

    const buffer = await this.sourceStorage.download(img.sourcePath); // transient on failure → retry

    // sharp block: any failure here is deterministic (invalid/corrupt image) → mark failed + terminal.
    let outputs: { name: keyof ProfileImageDerivatives; size: number; buf: Buffer }[];
    try {
      const base = sharp(buffer, PROFILE_SHARP_INPUT_OPTS)
        .rotate()
        .resize(LARGEST_SIZE, LARGEST_SIZE, {
          fit: 'cover',
          position: 'attention',
          withoutEnlargement: true,
        });

      outputs = [];
      for (const [name, size] of PROFILE_DERIVATIVE_SPECS) {
        const pipeline =
          size === LARGEST_SIZE ? base.clone() : base.clone().resize(size, size, { fit: 'cover' });
        const buf = await pipeline.webp({ quality: PROFILE_WEBP_QUALITY }).toBuffer();
        outputs.push({ name, size, buf });
      }
    } catch (err) {
      await this.images.markFailed(img.id);
      throw new ProfileDeriveTerminalError(`derivative generation failed: ${String(err)}`);
    }

    // Uploads: a failure here is transient (storage/network) → rethrow so the job retries.
    const derivatives: ProfileImageDerivatives = {};
    for (const { name, size, buf } of outputs) {
      const path = profilePrivateDerivativePath(img.id, size);
      await this.sourceStorage.upload(path, buf, 'image/webp', { upsert: true });
      derivatives[name] = path;
    }
    await this.images.markReady(img.id, derivatives);
    this.logger.log(`generated derivatives for profile image ${img.id}`);
  }
}
