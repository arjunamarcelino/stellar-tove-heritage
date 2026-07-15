import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMissionsTable1716000000005 implements MigrationInterface {
  name = 'CreateMissionsTable1716000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "missions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "stage_id" uuid NOT NULL,
        "title" varchar(255) NOT NULL,
        "description" text,
        "order" integer NOT NULL,
        "evidence_type" varchar(32) NOT NULL,
        "verification_method" varchar(64) NOT NULL DEFAULT 'manual',
        "verification_config" jsonb,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_by" uuid NOT NULL,
        "updated_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_missions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_missions_stage_id" FOREIGN KEY ("stage_id")
          REFERENCES "stages" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_missions_created_by" FOREIGN KEY ("created_by")
          REFERENCES "admins" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_missions_updated_by" FOREIGN KEY ("updated_by")
          REFERENCES "admins" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "missions" ADD CONSTRAINT "CHK_missions_order"
        CHECK ("order" > 0)
    `);

    await queryRunner.query(`
      ALTER TABLE "missions" ADD CONSTRAINT "CHK_missions_evidence_type"
        CHECK ("evidence_type" IN ('file', 'url', 'text'))
    `);

    await queryRunner.query(`
      ALTER TABLE "missions" ADD CONSTRAINT "CHK_missions_verification_method"
        CHECK ("verification_method" IN ('manual', 'auto_x_follow', 'auto_instagram_follow'))
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_missions_stage_order_active"
        ON "missions" ("stage_id", "order")
        WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_missions_created_by"
        ON "missions" ("created_by")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_missions_updated_by"
        ON "missions" ("updated_by")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_missions_created_at"
        ON "missions" ("created_at" DESC)
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_missions_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_missions_updated_by"`);
    await queryRunner.query(`DROP INDEX "IDX_missions_created_by"`);
    await queryRunner.query(`DROP INDEX "UQ_missions_stage_order_active"`);
    await queryRunner.query(`ALTER TABLE "missions" DROP CONSTRAINT "CHK_missions_verification_method"`);
    await queryRunner.query(`ALTER TABLE "missions" DROP CONSTRAINT "CHK_missions_evidence_type"`);
    await queryRunner.query(`ALTER TABLE "missions" DROP CONSTRAINT "CHK_missions_order"`);
    await queryRunner.query(`DROP TABLE "missions"`);
  }
}
