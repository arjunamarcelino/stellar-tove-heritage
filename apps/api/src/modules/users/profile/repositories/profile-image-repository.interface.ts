import { ProfileImage } from '../entities/profile-image.entity';
import { ProfileImageDerivatives } from '../constants/profile-image.constants';

/** DI token — string equals the interface name (house convention). */
export const PROFILE_IMAGE_REPOSITORY = 'IProfileImageRepository';

export interface IProfileImageRepository {
  /** Insert a `pending` row with a caller-chosen id (so the source path is known before the URL is minted). */
  createPending(userId: string, imageId: string, sourcePath: string): Promise<ProfileImage>;
  /** Owner-scoped lookup (excludes soft-deleted). */
  findOwned(id: string, userId: string): Promise<ProfileImage | null>;
  /** Lookup by id (any owner; excludes soft-deleted) — for the worker / maintenance jobs. */
  findById(id: string): Promise<ProfileImage | null>;
  /** Count non-terminal (pending/processing) rows for a user — the per-user in-flight ceiling. */
  countNonTerminalByUser(userId: string): Promise<number>;
  /**
   * Atomic `pending → processing` transition (`UPDATE … WHERE status='pending'`). Returns true iff this
   * caller won the race; false means another commit already claimed it (→ 409 ALREADY_COMMITTED).
   */
  claimForProcessing(id: string, userId: string): Promise<boolean>;
  /** Stamp `ready` + the private derivative paths (worker success). */
  markReady(id: string, derivatives: ProfileImageDerivatives): Promise<void>;
  /** Stamp `failed` (invalid image / terminal worker failure). */
  markFailed(id: string): Promise<void>;
  /** Owner-scoped soft delete. Returns true iff a live row matched. */
  softDeleteOwned(id: string, userId: string): Promise<boolean>;
  /**
   * Atomically soft-delete an owned image AND, if it is the user's active avatar, null
   * `users.profile_image_id` — in one transaction (the FK SET NULL never fires under soft delete).
   * Returns true iff a live image row matched.
   */
  softDeleteAndClearAvatar(userId: string, imageId: string): Promise<boolean>;
  /** Rows stuck in `processing` with `updated_at` older than the cutoff (reconcile re-drive / fail). */
  findStuckProcessing(olderThan: Date, limit: number): Promise<ProfileImage[]>;
  /**
   * Reapable rows: `pending`/`failed` older than the grace cutoff, OR any soft-deleted row (their blobs
   * are reclaimed). Includes soft-deleted rows (withDeleted).
   */
  findReapable(cutoff: Date, limit: number): Promise<ProfileImage[]>;
  /** Hard-delete a row after its blobs are purged (reaper). */
  hardDelete(id: string): Promise<void>;
  /** All of a user's live images (any status) — for account-erasure purge. */
  findAllForUser(userId: string): Promise<ProfileImage[]>;
  /** Soft-delete ALL of a user's images (account erasure); the reaper then reclaims their private blobs. */
  softDeleteAllForUser(userId: string): Promise<void>;
}
