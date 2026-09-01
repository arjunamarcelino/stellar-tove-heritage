import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The clearing-walk index for uniform-price settlement (TOV-160, FR-05.05). SPLIT from `…038` into its own
 * `transaction:false` migration so it can be built with `CREATE INDEX CONCURRENTLY` — a non-CONCURRENTLY
 * build takes a `ShareLock` on `offering_bids` that blocks EVERY bid INSERT/UPDATE for the whole build, and
 * `lock_timeout` bounds only lock *acquisition*, not the (unbounded, full-scan) build, so on a grown money
 * table an in-txn build is a write outage. `offering_bids` grows unbounded (bid → cancel → re-bid), so this
 * follows the migration-`009` precedent, NOT the in-txn `037` index rebuilds.
 *
 * The index serves `OfferingBidRepository.listBidsForClearing`'s sorted walk
 * (`ORDER BY price_stroops DESC, created_at ASC, id ASC`) as an index-ordered scan with NO Sort node — the
 * `DESC price` is load-bearing (a mixed-direction order can't be served by an all-ASC index via a backward
 * scan). The `id ASC` tail is retained only as a deterministic stable scan; since TOV-162 the clearing
 * ALGORITHM re-sorts internally with `chain_bid_id` (not `id`) as the FCFS tiebreak (`id` is absent from the
 * settlement snapshot, so it could not be belt-verified — see `clearing.ts`), so this DB order no longer
 * mirrors the algorithm's tiebreak. Correctness is unaffected because `computeClearing` re-sorts. The
 * predicate is `WHERE deleted_at IS NULL` only: `status` is MUTABLE (submitted→escrowed→won/lost), and a
 * mutable column in a partial-index predicate churns the index on every transition and defeats HOT; the
 * leading `offering_id` already bounds the scan to one offering's small book, so the residual
 * `Filter: status='escrowed'` is cheap.
 *
 * `transaction:false` means a mid-migration throw is NOT rolled back and the `migrations` row is not written,
 * so each step must be re-runnable — the leading `DROP INDEX CONCURRENTLY IF EXISTS` clears an INVALID
 * leftover from a failed prior build. `down()` also drops CONCURRENTLY (additive-only, so unconditional).
 */
export class AddOfferingBidsClearingIndex1716000000039 implements MigrationInterface {
  // CONCURRENTLY cannot run inside a transaction.
  transaction = false as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // RESET the session lock_timeout FIRST. TypeORM's MigrationExecutor reuses ONE queryRunner connection
    // for the whole `migration:run`, and every prior money migration (034/036/037/038) does a plain
    // `SET lock_timeout='3s'` (session-scoped, not SET LOCAL) that survives COMMIT — so without this RESET,
    // this CONCURRENTLY build would inherit the 3s timeout and abort under any concurrent long txn on
    // offering_bids, defeating the whole point of the online-index split.
    await queryRunner.query(`RESET lock_timeout`);
    // No lock_timeout: CONCURRENTLY takes only a brief ShareUpdateExclusive; bid writes keep flowing.
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "IDX_offering_bids_clearing"`);
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_offering_bids_clearing"
        ON "offering_bids" ("offering_id", "price_stroops" DESC, "created_at" ASC, "id" ASC)
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "IDX_offering_bids_clearing"`);
  }
}
