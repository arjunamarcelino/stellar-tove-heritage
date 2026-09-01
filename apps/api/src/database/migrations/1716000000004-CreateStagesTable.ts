import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStagesTable1716000000004 implements MigrationInterface {
  name = 'CreateStagesTable1716000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "stages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "title" varchar(255) NOT NULL,
        "description" text,
        "order" integer NOT NULL,
        "is_active" boolean NOT NULL DEFAULT false,
        "starts_at" timestamptz,
        "created_by" uuid NOT NULL,
        "updated_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_stages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_stages_created_by" FOREIGN KEY ("created_by")
          REFERENCES "admins" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_stages_updated_by" FOREIGN KEY ("updated_by")
          REFERENCES "admins" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "stages" ADD CONSTRAINT "CHK_stages_order"
        CHECK ("order" > 0)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_stages_order_active"
        ON "stages" ("order")
        WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_stages_created_by"
        ON "stages" ("created_by")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_stages_updated_by"
        ON "stages" ("updated_by")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_stages_created_at"
        ON "stages" ("created_at" DESC)
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_stages_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_stages_updated_by"`);
    await queryRunner.query(`DROP INDEX "IDX_stages_created_by"`);
    await queryRunner.query(`DROP INDEX "UQ_stages_order_active"`);
    await queryRunner.query(`ALTER TABLE "stages" DROP CONSTRAINT "CHK_stages_order"`);
    await queryRunner.query(`DROP TABLE "stages"`);
  }
}
