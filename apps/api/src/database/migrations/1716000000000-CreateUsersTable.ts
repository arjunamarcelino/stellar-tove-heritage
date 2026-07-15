import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersTable1716000000000 implements MigrationInterface {
  name = 'CreateUsersTable1716000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable citext extension
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "citext"`);

    // Create users table
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" citext NOT NULL,
        "password_hash" character varying(72) NOT NULL,
        "role" character varying(32) NOT NULL DEFAULT 'user',
        "first_name" character varying,
        "last_name" character varying,
        "is_active" boolean NOT NULL DEFAULT true,
        "refresh_token_hash" character varying(64),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);

    // Partial unique index for email — soft-delete compatible
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_users_email_active"
        ON "users" ("email")
        WHERE "deleted_at" IS NULL
    `);

    // Role CHECK constraint instead of native enum
    await queryRunner.query(`
      ALTER TABLE "users" ADD CONSTRAINT "CHK_users_role"
        CHECK ("role" IN ('user', 'admin'))
    `);

    // Query performance indexes
    await queryRunner.query(`
      CREATE INDEX "IDX_users_role_active"
        ON "users" ("role", "is_active")
        WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_users_created_at"
        ON "users" ("created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_users_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_users_role_active"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_role"`);
    await queryRunner.query(`DROP INDEX "UQ_users_email_active"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
