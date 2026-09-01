import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubmissionsMissionUserStatusIndex1716000000009 implements MigrationInterface {
  // CONCURRENTLY cannot run inside a transaction
  transaction = false as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY "IDX_submissions_mission_user_status"
        ON "submissions" ("mission_id", "user_id", "status")
        WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_submissions_mission_id"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_submissions_mission_user_status"`);
    await queryRunner.query(`
      CREATE INDEX "IDX_submissions_mission_id"
        ON "submissions" ("mission_id")
        WHERE "deleted_at" IS NULL
    `);
  }
}
