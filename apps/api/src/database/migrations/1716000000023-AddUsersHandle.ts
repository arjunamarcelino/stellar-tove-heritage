import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Globally-unique pseudonymous collector handles (TOV-26, FR-01.05). `handle` stores the
 * collector-typed display casing; `handle_canonical` is DB-generated `lower(handle)` and carries a
 * partial unique index scoped to LIVE, handle-bearing rows — case-insensitive uniqueness that cannot
 * drift, and the single source of truth for concurrent-claim serialization (loser gets 23505 → 409).
 *
 * ⚠️ LOCK PROFILE: adding a STORED generated column REWRITES the whole `users` table under
 * ACCESS EXCLUSIVE (this is NOT the fast catalog-only `NOT NULL DEFAULT` path). The subsequent plain
 * `CREATE UNIQUE INDEX` takes a SHARE lock (blocks writes while it builds). Accepted at the current
 * `users` size (early-stage; deploy drains writers) — same assumption as migration …020. If `users`
 * ever grows large, split into (1) a plain nullable `text` column + batched backfill + sync trigger,
 * and (2) a separate `transaction = false` migration using `CREATE UNIQUE INDEX CONCURRENTLY`
 * (CONCURRENTLY cannot run inside TypeORM's per-migration transaction).
 *
 * `handle_canonical` is `text` (not varchar(24)) so the generated expression can never raise 22001:
 * lower() is length-preserving for our ASCII charset, but keeping the canonical uncapped removes the
 * footgun if `handle` is ever written outside the service.
 *
 * ⚠️ RESTORE INVARIANT: because the partial index excludes soft-deleted rows, a deleted collector's
 * handle is released and can be re-claimed by someone else. If that original collector is later
 * RESTORED (deleted_at → NULL), their handle re-enters the index and can collide with the live
 * re-claimer → 23505 on a write path OUTSIDE `HandleService.setHandle`'s try/catch (i.e. a raw 500).
 * There is no restore/undelete path today; any future one MUST clear/rename `handle` on restore (or
 * catch 23505 and force re-selection). See users/CLAUDE.md and the TOV-26 plan (AC16).
 */
export class AddUsersHandle1716000000023 implements MigrationInterface {
  name = 'AddUsersHandle1716000000023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Collector-typed display casing (validated 3–24 in the app; varchar(24) is the length backstop).
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "handle" varchar(24)`);

    // DB-computed canonical. lower(NULL) = NULL, so handle-less collectors stay out of the partial
    // unique index below. GENERATED … STORED is PG12+ (we run PG16) and forces the table rewrite noted.
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "handle_canonical" text
        GENERATED ALWAYS AS (lower("handle")) STORED
    `);

    // Global case-insensitive uniqueness over LIVE, handle-bearing rows only. The
    // `handle_canonical IS NOT NULL` predicate keeps every handle-less user OUT of the index (avoids
    // index bloat on a table where most rows initially have no handle) — it is NOT redundant.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_users_handle_canonical_active"
        ON "users" ("handle_canonical")
        WHERE "handle_canonical" IS NOT NULL AND "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ⚠️ DATA LOSS: `handle` is collector-chosen and NOT re-derivable. Fail-closed in prod unless
    // explicitly opted in — mirrors AddWalletsIsPrimary1716000000020. Drop order: index → generated
    // column → base column (handle_canonical depends on handle).
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DESTRUCTIVE_DOWN !== '1') {
      throw new Error(
        'Refusing to revert AddUsersHandle1716000000023 in production: dropping "handle" discards ' +
          'collector-chosen identities. Export handles, then set ALLOW_DESTRUCTIVE_DOWN=1 to proceed.',
      );
    }
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_users_handle_canonical_active"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "handle_canonical"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "handle"`);
  }
}
