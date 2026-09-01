import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Public artwork detail (TOV-189, FR-08.01). Adds the net-new schema the public
 * `GET /api/v1/artworks/:id` detail response needs beyond the fractionalize path (TOV-233):
 *
 *  - `artworks.custodian`        — a PUBLIC display label for the current custodian (nullable).
 *  - `artworks.coa_storage_path` — storage path to the Certificate of Authenticity, signed on read
 *                                  via `StorageService.createTemporaryUrl` (nullable; never returned raw).
 *  - `artwork_images`            — supporting images (one row per image), ordered by `sort_order`,
 *                                  each a storage path signed on read. `ON DELETE CASCADE` (images are
 *                                  fully owned by the artwork aggregate and carry no independent value).
 *
 * Both columns are nullable → PostgreSQL adds them as a metadata-only change (no table rewrite, no long
 * ACCESS EXCLUSIVE hold). `CREATE TABLE`/`CREATE INDEX` touch only the brand-new empty table.
 *
 * No demo seed here — migrations carry schema, not fixtures (tests seed via `test/shared/seed-artwork`;
 * local demos use that helper). This avoids the `23503` hazard of INSERTing image rows that reference
 * migration-027 seed artworks which may not exist (that seed is `FRACTION_SEED_FIXTURES`-gated).
 *
 * List ordering reuses the existing `IDX_artworks_status_created_at (status, created_at DESC)
 * WHERE deleted_at IS NULL` from migration …030 — no new index needed.
 */
export class AddArtworkImagesCoaCustodian1716000000046 implements MigrationInterface {
  name = 'AddArtworkImagesCoaCustodian1716000000046';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);

    // Additive, nullable → metadata-only ADD COLUMN (no rewrite).
    await queryRunner.query(`
      ALTER TABLE "artworks"
        ADD COLUMN "custodian"        varchar(200),
        ADD COLUMN "coa_storage_path" text
    `);

    await queryRunner.query(`
      CREATE TABLE "artwork_images" (
        "id"           uuid        NOT NULL DEFAULT gen_random_uuid(),
        "artwork_id"   uuid        NOT NULL,
        "storage_path" text        NOT NULL,
        "sort_order"   int         NOT NULL DEFAULT 0,
        "created_at"   timestamptz NOT NULL DEFAULT now(),
        "updated_at"   timestamptz NOT NULL DEFAULT now(),
        "deleted_at"   timestamptz,
        CONSTRAINT "PK_artwork_images" PRIMARY KEY ("id"),
        CONSTRAINT "FK_artwork_images_artwork" FOREIGN KEY ("artwork_id")
          REFERENCES "artworks" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_artwork_images_storage_path_nonempty" CHECK (length(btrim("storage_path")) > 0),
        CONSTRAINT "CHK_artwork_images_sort_order_nonneg" CHECK ("sort_order" >= 0)
      )
    `);
    // Serves the detail read: WHERE artwork_id = $1 AND deleted_at IS NULL ORDER BY sort_order ASC.
    await queryRunner.query(`
      CREATE INDEX "IDX_artwork_images_artwork" ON "artwork_images" ("artwork_id", "sort_order")
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Fail-closed allowlist guard: DROP TABLE / DROP COLUMN here is destructive of COA linkage,
    // custodian, and every supporting-image row. Only permit in explicitly non-prod environments.
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        'Refusing to revert AddArtworkImagesCoaCustodian1716000000046 outside development/test: ' +
          'it drops "artwork_images" plus artworks.coa_storage_path/custodian (data loss). ' +
          `Roll back the deployment instead. (NODE_ENV=${process.env.NODE_ENV ?? 'unset'})`,
      );
    }
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_artwork_images_artwork"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "artwork_images"`);
    await queryRunner.query(`
      ALTER TABLE "artworks"
        DROP COLUMN IF EXISTS "coa_storage_path",
        DROP COLUMN IF EXISTS "custodian"
    `);
  }
}
