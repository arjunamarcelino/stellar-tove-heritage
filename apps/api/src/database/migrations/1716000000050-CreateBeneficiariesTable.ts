import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TOV-31 (FR-01.10) — the `beneficiaries` table: one inheritance-beneficiary designation per Collector.
 *
 * Additive `CREATE TABLE` (no rewrite of existing tables). One ACTIVE row per user via the partial-unique
 * index `UQ_beneficiaries_user_active (user_id) WHERE deleted_at IS NULL`. The FK `ON DELETE CASCADE` is a
 * belt for a future HARD user-purge; account soft-delete never fires it, so a `BeneficiaryErasureService`
 * hard-deletes the row on account deletion (the app path). Removal in general is a HARD delete (third-party
 * PII must not linger) — the `deleted_at` column exists only for `BaseEntity` conformance and stays NULL.
 *
 * `SET LOCAL lock_timeout` auto-resets at COMMIT (can't leak onto a later migration on the shared conn).
 * `down()` fails CLOSED outside dev/test — dropping this table is real (third-party) PII loss.
 */
export class CreateBeneficiariesTable1716000000050 implements MigrationInterface {
  name = 'CreateBeneficiariesTable1716000000050';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);

    await queryRunner.query(`
      CREATE TABLE "beneficiaries" (
        "id"             uuid         NOT NULL DEFAULT gen_random_uuid(),
        "user_id"        uuid         NOT NULL,
        "name"           varchar(200) NOT NULL,
        "email"          varchar(320) NOT NULL,
        "stellar_pubkey" varchar(56),
        "relationship"   varchar(64),
        "notes"          varchar(1000),
        "created_at"     timestamptz  NOT NULL DEFAULT now(),
        "updated_at"     timestamptz  NOT NULL DEFAULT now(),
        "deleted_at"     timestamptz,
        CONSTRAINT "PK_beneficiaries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_beneficiaries_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_beneficiaries_name_nonempty"  CHECK (length(btrim("name"))  > 0),
        CONSTRAINT "CHK_beneficiaries_email_nonempty" CHECK (length(btrim("email")) > 0)
      )
    `);

    // One active beneficiary per Collector (the sole authoritative guard) + serves findByUserId.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_beneficiaries_user_active" ON "beneficiaries"
        ("user_id") WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        `Refusing to revert CreateBeneficiariesTable1716000000050 outside development/test (NODE_ENV=` +
          `${process.env.NODE_ENV ?? 'unset'}): it drops the beneficiaries table (third-party PII loss). ` +
          'Roll back the deployment instead.',
      );
    }
    // DROP TABLE also drops the table's owned indexes (incl. UQ_beneficiaries_user_active).
    await queryRunner.query(`DROP TABLE IF EXISTS "beneficiaries"`);
  }
}
