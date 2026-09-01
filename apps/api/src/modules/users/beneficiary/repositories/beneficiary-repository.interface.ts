import { EntityManager } from 'typeorm';
import { IBaseRepository } from '@common/repositories/base-repository.interface';
import { Beneficiary } from '../entities/beneficiary.entity';

/** DI token — string equals the interface name (house convention). */
export const BENEFICIARY_REPOSITORY = 'IBeneficiaryRepository';

/** The writable fields of a beneficiary, already normalized (email lowercased, absent optionals → null). */
export type BeneficiaryWriteFields = Readonly<{
  name: string;
  email: string;
  stellarPubkey: string | null;
  relationship: string | null;
  notes: string | null;
}>;

export interface IBeneficiaryRepository extends IBaseRepository<Beneficiary> {
  /** The user's single active beneficiary (excludes soft-deleted, which never exist in practice). */
  findByUserId(userId: string, manager?: EntityManager): Promise<Beneficiary | null>;
  /** Insert a new active beneficiary for the user (inside the caller's transaction). */
  createForUser(userId: string, data: BeneficiaryWriteFields, manager: EntityManager): Promise<Beneficiary>;
  /**
   * `UPDATE … WHERE id=:id AND deleted_at IS NULL` then re-read. Returns the updated row, or `null` when
   * 0 rows matched (a concurrent delete removed it) — the caller then re-branches to insert.
   */
  applyUpdate(id: string, data: BeneficiaryWriteFields, manager: EntityManager): Promise<Beneficiary | null>;
  /**
   * HARD-delete the user's beneficiary row (third-party PII must not linger). Returns the removed row's id
   * (for the audit `subject_id`), or `null` when the user had none.
   */
  deleteByUserId(userId: string, manager?: EntityManager): Promise<string | null>;
  /**
   * Erasure-reconcile backstop: bulk HARD-delete beneficiaries whose owning user is soft-deleted (the
   * best-effort per-account purge may have failed / crashed). Returns the number of rows purged.
   */
  deleteOrphansOfDeletedUsers(): Promise<number>;
}
