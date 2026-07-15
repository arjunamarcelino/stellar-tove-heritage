import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminsTable1716000000002 implements MigrationInterface {
  name = 'CreateAdminsTable1716000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "citext"`);

    await queryRunner.query(`
      CREATE TABLE "admins" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" citext NOT NULL,
        "password_hash" character varying(72) NOT NULL,
        "role" character varying(32) NOT NULL DEFAULT 'admin',
        "first_name" character varying(255),
        "last_name" character varying(255),
        "is_active" boolean NOT NULL DEFAULT true,
        "refresh_token_hash" character varying(64),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_admins" PRIMARY KEY ("id")
      )
    `);

    // Partial unique index for email -- soft-delete compatible
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_admins_email_active"
        ON "admins" ("email")
        WHERE "deleted_at" IS NULL
    `);

    // Role CHECK constraint
    await queryRunner.query(`
      ALTER TABLE "admins"
        ADD CONSTRAINT "CHK_admins_role" CHECK ("role" IN ('admin', 'superadmin'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "admins" DROP CONSTRAINT "CHK_admins_role"`);
    await queryRunner.query(`DROP INDEX "UQ_admins_email_active"`);
    await queryRunner.query(`DROP TABLE "admins"`);
  }
}
