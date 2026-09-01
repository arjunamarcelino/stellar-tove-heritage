import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TOV-30 (PR #53 review #408) — index the reaper's soft-deleted branch.
 *
 * `IDX_profile_images_reap (status, created_at) WHERE deleted_at IS NULL` (migration 048) serves the
 * stale-terminal reap query, but its partial predicate EXCLUDES soft-deleted rows, so the reaper's
 * `deleted_at IS NOT NULL` branch fell back to a Seq Scan. This adds the complementary partial index so
 * both branches are index-served. Plain CREATE INDEX (table is small/new); `SET LOCAL lock_timeout` bounds
 * the brief lock.
 */
export class AddProfileImagesReapDeletedIndex1716000000049 implements MigrationInterface {
  name = 'AddProfileImagesReapDeletedIndex1716000000049';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(`
      CREATE INDEX "IDX_profile_images_reap_deleted" ON "profile_images"
        ("created_at") WHERE "deleted_at" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        `Refusing to revert AddProfileImagesReapDeletedIndex1716000000049 outside development/test ` +
          `(NODE_ENV=${process.env.NODE_ENV ?? 'unset'}).`,
      );
    }
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profile_images_reap_deleted"`);
  }
}
