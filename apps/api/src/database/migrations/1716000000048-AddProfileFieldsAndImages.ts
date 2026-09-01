import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TOV-30 (FR-01.09) — optional profile fields on `users` + the `profile_images` avatar lifecycle table.
 *
 * `profile_images` is created FIRST (its FK → `users` which already exists); then `users.profile_image_id`
 * + FK → `profile_images` is added — the circular reference is safe because `each`-mode wraps this whole
 * `up()` in one transaction. The declared FK actions (SET NULL / CASCADE) never fire under TypeORM soft
 * deletes; they are the belt for any future hard purge, while the app nulls `profile_image_id` in-txn.
 *
 * The new `users` columns are additive + nullable → a metadata-only `ADD COLUMN` (no table rewrite).
 * `CHK_users_social_links_object` asserts `social_links` is a json object (app-only validation otherwise).
 * Two partial indexes on `profile_images`: `IDX_profile_images_user` (owner lookups / status poll) and
 * `IDX_profile_images_reap` (the DB-driven reconcile + reaper: `status, created_at`).
 */
export class AddProfileFieldsAndImages1716000000048 implements MigrationInterface {
  name = 'AddProfileFieldsAndImages1716000000048';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // SET LOCAL: auto-resets at COMMIT, so the ceiling can't leak onto a later migration on the shared conn.
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);

    await queryRunner.query(`
      CREATE TABLE "profile_images" (
        "id"          uuid         NOT NULL DEFAULT gen_random_uuid(),
        "user_id"     uuid         NOT NULL,
        "status"      varchar(16)  NOT NULL DEFAULT 'pending',
        "source_path" text         NOT NULL,
        "derivatives" jsonb        NOT NULL DEFAULT '{}',
        "created_at"  timestamptz  NOT NULL DEFAULT now(),
        "updated_at"  timestamptz  NOT NULL DEFAULT now(),
        "deleted_at"  timestamptz,
        CONSTRAINT "PK_profile_images" PRIMARY KEY ("id"),
        CONSTRAINT "FK_profile_images_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_profile_images_status"
          CHECK ("status" IN ('pending', 'processing', 'ready', 'failed')),
        CONSTRAINT "CHK_profile_images_source_path_nonempty"
          CHECK (length(btrim("source_path")) > 0)
      )
    `);

    // Owner lookups + status poll (both filter by user_id, exclude soft-deleted).
    await queryRunner.query(`
      CREATE INDEX "IDX_profile_images_user" ON "profile_images"
        ("user_id", "created_at") WHERE "deleted_at" IS NULL
    `);
    // DB-driven reconcile (stuck 'processing') + reaper (stale 'pending'/'failed').
    await queryRunner.query(`
      CREATE INDEX "IDX_profile_images_reap" ON "profile_images"
        ("status", "created_at") WHERE "deleted_at" IS NULL
    `);

    // Additive + nullable → metadata-only ADD COLUMN (no rewrite).
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "bio"              varchar(300),
        ADD COLUMN "statement"        varchar(500),
        ADD COLUMN "social_links"     jsonb,
        ADD COLUMN "profile_image_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "CHK_users_social_links_object"
          CHECK ("social_links" IS NULL OR jsonb_typeof("social_links") = 'object')
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "FK_users_profile_image" FOREIGN KEY ("profile_image_id")
          REFERENCES "profile_images" ("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Fail CLOSED outside dev/test: dropping these columns/table is real data loss (bio/statement/social
    // links + every avatar record). Roll back the deployment instead of reverting the migration.
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        `Refusing to revert AddProfileFieldsAndImages1716000000048 outside development/test (NODE_ENV=` +
          `${process.env.NODE_ENV ?? 'unset'}): it drops users profile columns + the profile_images table ` +
          '(permanent data loss). Roll back the deployment instead.',
      );
    }
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "FK_users_profile_image"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "CHK_users_social_links_object"`);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "profile_image_id",
        DROP COLUMN IF EXISTS "social_links",
        DROP COLUMN IF EXISTS "statement",
        DROP COLUMN IF EXISTS "bio"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profile_images_reap"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profile_images_user"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "profile_images"`);
  }
}
