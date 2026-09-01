import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFilesActiveUrlPathIndex1716000000010 implements MigrationInterface {
  name = 'AddFilesActiveUrlPathIndex1716000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_files_url_path_active_true"
        ON "files" ("url_path")
        WHERE "deleted_at" IS NULL AND "is_active" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_files_url_path_active_true"`);
  }
}
