import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMissionIndexesAndAcceptedConstraint1716000000007 implements MigrationInterface {
  name = 'AddMissionIndexesAndAcceptedConstraint1716000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_missions_stage_id"
        ON "missions" ("stage_id")
        WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_submissions_user_id"
        ON "submissions" ("user_id")
        WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_submissions_user_mission_accepted"
        ON "submissions" ("user_id", "mission_id")
        WHERE "status" = 'accepted' AND "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_submissions_user_mission_accepted"`);
    await queryRunner.query(`DROP INDEX "IDX_submissions_user_id"`);
    await queryRunner.query(`DROP INDEX "IDX_missions_stage_id"`);
  }
}
