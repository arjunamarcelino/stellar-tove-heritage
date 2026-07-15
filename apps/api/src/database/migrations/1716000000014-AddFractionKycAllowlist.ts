import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * fraction_kyc_allowlist (TOV-40, FR-01.02c): KYC-allowlisted destination addresses an embedded wallet
 * may export to. Read-only from the backend; seeded by the KYC review flow. Soft-deletable (a revocation
 * must be auditable), with a partial unique index so a revoked address can be re-added later.
 */
export class AddFractionKycAllowlist1716000000014 implements MigrationInterface {
  name = 'AddFractionKycAllowlist1716000000014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "fraction_kyc_allowlist" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "target_address" varchar(56) NOT NULL,
        "note" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_fraction_kyc_allowlist" PRIMARY KEY ("id")
      )
    `);
    // One live row per address; a soft-deleted (revoked) row does not block re-adding the same address.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_fraction_kyc_allowlist_target_active"
        ON "fraction_kyc_allowlist" ("target_address")
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_fraction_kyc_allowlist_target_active"`);
    await queryRunner.query(`DROP TABLE "fraction_kyc_allowlist"`);
  }
}
