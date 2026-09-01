import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Replace the status-only partial index with a composite `(status, created_at DESC)` partial index
 * (TOV-240). The admin artwork list filters `status IN (...) AND deleted_at IS NULL ORDER BY created_at
 * DESC`; the old `IDX_artworks_status` covered the filter but not the sort, forcing an explicit top-N
 * sort per request. The composite serves both the filter and the ordering (and the `findAndCount` count),
 * so it supersedes the status-only index — dropped here to avoid redundancy.
 *
 * House convention (…025/…026/…027): bound the exclusive-lock acquisition with `lock_timeout`. `CREATE
 * INDEX` (non-CONCURRENTLY, since migrations run in a transaction) takes a brief ACCESS EXCLUSIVE lock —
 * instantaneous on the near-empty `artworks` table. If this table ever grows large before deploy, run the
 * index build out-of-band with `CONCURRENTLY` instead.
 */
export class AddArtworksStatusCreatedAtIndex1716000000030 implements MigrationInterface {
  name = 'AddArtworksStatusCreatedAtIndex1716000000030';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(`
      CREATE INDEX "IDX_artworks_status_created_at"
        ON "artworks" ("status", "created_at" DESC) WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_artworks_status"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(`
      CREATE INDEX "IDX_artworks_status" ON "artworks" ("status") WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_artworks_status_created_at"`);
  }
}
