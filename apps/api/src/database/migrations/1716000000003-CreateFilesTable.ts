import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFilesTable1716000000003 implements MigrationInterface {
  name = 'CreateFilesTable1716000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "files" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "title" varchar(255) NOT NULL,
        "url_path" varchar(255) NOT NULL,
        "storage_path" varchar(512) NOT NULL,
        "file_size" integer NOT NULL,
        "original_filename" varchar(255) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_by" uuid NOT NULL,
        "updated_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_files" PRIMARY KEY ("id"),
        CONSTRAINT "FK_files_created_by" FOREIGN KEY ("created_by")
          REFERENCES "admins" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_files_updated_by" FOREIGN KEY ("updated_by")
          REFERENCES "admins" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_files_url_path_active"
        ON "files" ("url_path")
        WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "files" ADD CONSTRAINT "CHK_files_file_size"
        CHECK ("file_size" > 0)
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_files_created_by"
        ON "files" ("created_by")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_files_updated_by"
        ON "files" ("updated_by")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_files_created_at"
        ON "files" ("created_at" DESC)
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_files_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_files_updated_by"`);
    await queryRunner.query(`DROP INDEX "IDX_files_created_by"`);
    await queryRunner.query(`ALTER TABLE "files" DROP CONSTRAINT "CHK_files_file_size"`);
    await queryRunner.query(`DROP INDEX "UQ_files_url_path_active"`);
    await queryRunner.query(`DROP TABLE "files"`);
  }
}
