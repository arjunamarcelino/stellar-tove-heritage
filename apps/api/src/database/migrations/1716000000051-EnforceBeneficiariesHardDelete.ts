import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enforce the beneficiaries hard-delete-only invariant at the DB layer (TOV-31, review todo 420). The domain
 * requires third-party PII (name/email/notes) to be **physically purged** on removal, so `deleted_at` must
 * stay NULL forever — but `Beneficiary extends BaseEntity`, leaving `softRemove()` reachable, and the
 * partial-unique index would even permit a second active row alongside a soft-deleted skeleton. A
 * BEFORE UPDATE trigger that RAISEs whenever `deleted_at` is set makes the invariant defense-in-depth
 * (role-agnostic, enforced in fact not by convention), mirroring `internal_audit_log`'s append-only guard
 * and the `fn_*_guard` triggers on the marketplace/offering PII tables. Hard `DELETE` is unaffected
 * (BEFORE UPDATE does not fire on DELETE); normal field updates never touch `deleted_at`, so they pass.
 */
export class EnforceBeneficiariesHardDelete1716000000051 implements MigrationInterface {
  name = 'EnforceBeneficiariesHardDelete1716000000051';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "beneficiaries_no_soft_delete"() RETURNS trigger AS $$
      BEGIN
        IF NEW."deleted_at" IS NOT NULL THEN
          RAISE EXCEPTION 'beneficiaries is hard-delete only: setting deleted_at is not allowed (third-party PII must be physically purged)';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_beneficiaries_no_soft_delete"
        BEFORE UPDATE ON "beneficiaries"
        FOR EACH ROW EXECUTE FUNCTION "beneficiaries_no_soft_delete"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_beneficiaries_no_soft_delete" ON "beneficiaries"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "beneficiaries_no_soft_delete"()`);
  }
}
