import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropUserRoleColumn1716000000008 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS "CHK_users_role"`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS role`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'user'`);
    await queryRunner.query(
      `ALTER TABLE users ADD CONSTRAINT "CHK_users_role" CHECK (role IN ('user', 'admin'))`,
    );
    await queryRunner.query(`
      CREATE INDEX "IDX_users_role_active"
        ON "users" ("role", "is_active")
        WHERE "deleted_at" IS NULL
    `);
  }
}
