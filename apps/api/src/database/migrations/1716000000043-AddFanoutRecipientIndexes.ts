import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Indexes that serve the RFQ fan-out recipient query (TOV-174, FR-06.02):
 * `findSettledWinnerSubsForArtwork` = `offerings ⟕ offering_bids WHERE o.artwork_id=? AND ob.status='won'`.
 *
 * SPLIT into its own `transaction:false` migration so both are built with `CREATE INDEX CONCURRENTLY` — a
 * non-CONCURRENTLY build takes a ShareLock that blocks writes on `offerings`/`offering_bids` for the whole
 * build, and both tables grow unbounded. Follows the `…039` online-index precedent.
 *
 *  - `IDX_offerings_artwork`: without it, `o.artwork_id = ?` has NO usable index for SETTLED offerings — the
 *    only artwork_id index is `UQ_offerings_active_per_artwork`, whose partial predicate EXCLUDES `settled`,
 *    so the planner seq-scans `offerings` on every fan-out. (Reserved by migration 032's todo-264.)
 *  - `IDX_offering_bids_won_recipients`: winner extraction becomes `offering_id → collector_sub` with no heap
 *    fetch. `won` is terminal + write-once, so this partial index has zero churn (unlike the mutable-status
 *    clearing index).
 *
 * `transaction:false` → a mid-migration throw is not rolled back and the `migrations` row is not written, so
 * every step is re-runnable (leading `DROP INDEX CONCURRENTLY IF EXISTS` clears an INVALID leftover).
 */
export class AddFanoutRecipientIndexes1716000000043 implements MigrationInterface {
  // CONCURRENTLY cannot run inside a transaction.
  transaction = false as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // RESET the session lock_timeout FIRST: prior money migrations do a plain session-scoped SET that
    // survives COMMIT on the shared migration:run connection; without RESET the CONCURRENTLY builds would
    // inherit the 3s ceiling and abort under any concurrent long txn (defeating the online-index split).
    await queryRunner.query(`RESET lock_timeout`);

    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "IDX_offerings_artwork"`);
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_offerings_artwork"
        ON "offerings" ("artwork_id")
        WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "IDX_offering_bids_won_recipients"`);
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_offering_bids_won_recipients"
        ON "offering_bids" ("offering_id", "collector_sub")
        WHERE "status" = 'won' AND "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "IDX_offering_bids_won_recipients"`);
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "IDX_offerings_artwork"`);
  }
}
