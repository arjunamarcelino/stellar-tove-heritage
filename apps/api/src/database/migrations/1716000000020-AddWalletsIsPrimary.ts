import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Multi-wallet primary designation (TOV-24, FR-01.03). One wallet per Collector is the `is_primary`
 * wallet; a partial unique index enforces "at most one live primary per user" (soft-deleted rows drop
 * out, matching the `UQ_wallets_*_active` pattern). The primary wallet is delete-protected.
 *
 * `ADD COLUMN ... NOT NULL DEFAULT false` is a fast catalog-only default on PG11+ (no table rewrite).
 * The backfill marks each user's OLDEST live wallet primary — deterministic tie-break on (created_at,
 * id). The plain `CREATE UNIQUE INDEX` matches migration 1716000000013 and is safe at the current table
 * size (deploy drains writers). If `wallets` grows large, split the index into a `transaction = false`
 * migration using `CREATE UNIQUE INDEX CONCURRENTLY` (TypeORM wraps a migration in a tx, and
 * CONCURRENTLY cannot run inside one).
 */
export class AddWalletsIsPrimary1716000000020 implements MigrationInterface {
  name = 'AddWalletsIsPrimary1716000000020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD COLUMN "is_primary" boolean NOT NULL DEFAULT false`,
    );

    // Backfill: each user's oldest LIVE wallet becomes primary. DISTINCT ON keeps exactly one row per
    // user, so the unique index below cannot fail on this data. Deterministic tie-break (id) so replays
    // pick the same row.
    await queryRunner.query(`
      UPDATE "wallets" SET "is_primary" = true
      WHERE "id" IN (
        SELECT DISTINCT ON ("user_id") "id"
        FROM "wallets"
        WHERE "deleted_at" IS NULL
        ORDER BY "user_id", "created_at" ASC, "id" ASC
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_wallets_primary_active"
        ON "wallets" ("user_id")
        WHERE "is_primary" AND "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ⚠️ DATA LOSS: dropping `is_primary` discards the primary designation. This is now DESTRUCTIVE —
    // FR-01.04 (TOV-25) made the primary user-editable (POST /me/wallets/:id/primary + delete auto-promote),
    // so a user's chosen settlement wallet is NO LONGER re-derivable from wallet order. Re-`up()` would
    // re-mark each user's OLDEST wallet primary, silently overwriting deliberate selections.
    //
    // Hard-fail outside development so a routine `migration:revert` can't silently wipe user primaries; an
    // operator who genuinely needs it must opt in with ALLOW_DESTRUCTIVE_DOWN=1 (after exporting is_primary).
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DESTRUCTIVE_DOWN !== '1') {
      throw new Error(
        'Refusing to revert AddWalletsIsPrimary1716000000020 in production: dropping is_primary discards ' +
          'user-chosen settlement wallets (irreversible since TOV-25). Export is_primary, then set ' +
          'ALLOW_DESTRUCTIVE_DOWN=1 to proceed.',
      );
    }
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_wallets_primary_active"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN IF EXISTS "is_primary"`);
  }
}
