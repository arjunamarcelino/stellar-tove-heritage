import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSubmissionsTable1716000000006 implements MigrationInterface {
  name = 'CreateSubmissionsTable1716000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "submissions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "mission_id" uuid NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'pending',
        "file_url" varchar(512),
        "link_url" varchar(2048),
        "text_content" text,
        "admin_notes" text,
        "reviewed_by" uuid,
        "reviewed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_submissions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_submissions_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_submissions_mission_id" FOREIGN KEY ("mission_id")
          REFERENCES "missions" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_submissions_reviewed_by" FOREIGN KEY ("reviewed_by")
          REFERENCES "admins" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "submissions" ADD CONSTRAINT "CHK_submissions_status"
        CHECK ("status" IN ('pending', 'accepted', 'rejected'))
    `);

    await queryRunner.query(`
      ALTER TABLE "submissions" ADD CONSTRAINT "CHK_submissions_text_content_length"
        CHECK (char_length("text_content") <= 5000)
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_submissions_user_mission"
        ON "submissions" ("user_id", "mission_id")
        WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_submissions_user_mission_pending"
        ON "submissions" ("user_id", "mission_id")
        WHERE "status" = 'pending' AND "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_submissions_pending"
        ON "submissions" ("created_at" DESC)
        WHERE "status" = 'pending' AND "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_submissions_mission_id"
        ON "submissions" ("mission_id")
        WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_submissions_reviewed_by"
        ON "submissions" ("reviewed_by")
        WHERE "reviewed_by" IS NOT NULL AND "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_submissions_created_at"
        ON "submissions" ("created_at" DESC)
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_submissions_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_submissions_reviewed_by"`);
    await queryRunner.query(`DROP INDEX "IDX_submissions_mission_id"`);
    await queryRunner.query(`DROP INDEX "IDX_submissions_pending"`);
    await queryRunner.query(`DROP INDEX "UQ_submissions_user_mission_pending"`);
    await queryRunner.query(`DROP INDEX "IDX_submissions_user_mission"`);
    await queryRunner.query(`ALTER TABLE "submissions" DROP CONSTRAINT "CHK_submissions_text_content_length"`);
    await queryRunner.query(`ALTER TABLE "submissions" DROP CONSTRAINT "CHK_submissions_status"`);
    await queryRunner.query(`DROP TABLE "submissions"`);
  }
}
