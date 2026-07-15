import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeCreatedAtIndexPartial1716000000001 implements MigrationInterface {
  name = 'MakeCreatedAtIndexPartial1716000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_users_created_at"`);
    await queryRunner.query(`
      CREATE INDEX "IDX_users_created_at"
        ON "users" ("created_at" DESC)
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_users_created_at"`);
    await queryRunner.query(`
      CREATE INDEX "IDX_users_created_at"
        ON "users" ("created_at" DESC)
    `);
  }
}
