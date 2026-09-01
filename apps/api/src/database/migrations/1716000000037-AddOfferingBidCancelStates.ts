import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Primary-Offering bid CANCEL + USDC refund (TOV-158, FR-05.04). Additive `ALTER` on the `offering_bids`
 * money table (migration 036): widens the status vocabulary with `canceling`/`canceled`, adds the write-once
 * `refund_tx_hash`/`canceled_at` stamps, extends the forward-only guard trigger for the cancel machine, and
 * splits the two partial-unique indexes (the active-slot belt frees on `canceled`; the idem belt KEEPS
 * `canceled` because `submit_bid` sets a permanent on-chain `Idem` key that `cancel_bid` never clears).
 *
 * Lock discipline: every CHECK change uses `NOT VALID` + `VALIDATE` so validation can never FAIL (each
 * new/widened predicate is satisfied by all existing rows). NB (todo 313): this migration is ONE transaction
 * (`migrationsTransactionMode:'each'`) that opens with an ACCESS-EXCLUSIVE `ADD COLUMN` held until COMMIT, so
 * the VALIDATE scans and the two non-`CONCURRENTLY` index rebuilds all run under that lock — bid reads/writes
 * on `offering_bids` block for the migration's duration. Run it in a LOW-TRAFFIC WINDOW as a pre-deploy step
 * (the table is small today, so the scans are milliseconds; re-assess if it ever grows large). Single
 * transactional DDL — no `CONCURRENTLY`, no `transaction:false` — so the uniqueness constraint is never
 * briefly absent during the index recreation (the atomic swap is a deliberate tradeoff vs true online-ness).
 *
 * State machine after this migration (the guard trigger enforces exactly this — nothing more):
 *   submitted → escrowed | failed        (036)
 *   escrowed  → canceling                 (claim the cancel)
 *   canceling → canceled | escrowed       (refund landed | provably-no-refund revert / self-heal)
 * `canceled → escrowed` and the `escrowed → canceled` stamp-skip are rejected — the DB backstop against a
 * double-refund and against an unstamped terminal row.
 *
 * `down()` is fail-CLOSED (prod-guarded): it restores the 036 three-state guard body byte-for-byte (incl. its
 * inline comments, so `pg_proc.prosrc` matches a fresh 036 install), then re-adds the narrow `CHK_bid_status`
 * which ABORTS the whole revert (23514) if any `canceling`/`canceled` row exists — intentional for a table
 * recording real USDC refund provenance.
 */
export class AddOfferingBidCancelStates1716000000037 implements MigrationInterface {
  name = 'AddOfferingBidCancelStates1716000000037';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET lock_timeout = '3s'`);

    // 1) Write-once refund stamps (all existing rows get NULL → every new CHECK below is satisfied).
    await queryRunner.query(`
      ALTER TABLE "offering_bids"
        ADD COLUMN "refund_tx_hash" char(64),
        ADD COLUMN "canceled_at"    timestamptz
    `);

    // 2) Widen the status vocabulary (strict superset → NOT VALID + VALIDATE can't fail, stays low-lock).
    await queryRunner.query(`ALTER TABLE "offering_bids" DROP CONSTRAINT "CHK_bid_status"`);
    await queryRunner.query(`
      ALTER TABLE "offering_bids" ADD CONSTRAINT "CHK_bid_status"
        CHECK ("status" IN ('submitted','escrowed','failed','canceling','canceled')) NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "offering_bids" VALIDATE CONSTRAINT "CHK_bid_status"`);

    // 3) Refund-hash format belt (mirrors CHK_bid_txhash).
    await queryRunner.query(`
      ALTER TABLE "offering_bids" ADD CONSTRAINT "CHK_bid_refund_txhash"
        CHECK ("refund_tx_hash" IS NULL OR "refund_tx_hash" ~ '^[0-9a-f]{64}$') NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "offering_bids" VALIDATE CONSTRAINT "CHK_bid_refund_txhash"`);

    // 4) A canceled row MUST carry both stamps (single-UPDATE stamp guarantee).
    await queryRunner.query(`
      ALTER TABLE "offering_bids" ADD CONSTRAINT "CHK_bid_canceled_stamped"
        CHECK ("status" <> 'canceled' OR ("refund_tx_hash" IS NOT NULL AND "canceled_at" IS NOT NULL)) NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "offering_bids" VALIDATE CONSTRAINT "CHK_bid_canceled_stamped"`);

    // 5) The symmetric belt: a NON-canceled row must be stamp-CLEAN. Prevents a stray refund stamp on an
    //    escrowed/canceling row from later blocking (write-once) the real refund hash and falsifying the
    //    double-refund reconciliation signal. Also makes casCancelFailedBackToEscrowed structurally status-only.
    await queryRunner.query(`
      ALTER TABLE "offering_bids" ADD CONSTRAINT "CHK_bid_refund_clean"
        CHECK ("status" = 'canceled' OR ("refund_tx_hash" IS NULL AND "canceled_at" IS NULL)) NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "offering_bids" VALIDATE CONSTRAINT "CHK_bid_refund_clean"`);

    // 6) Replace the guard function: widen the forward-only machine to the EXACT legal cancel transitions and
    //    make refund_tx_hash/canceled_at write-once. Same function name → the existing trigger picks it up.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "fn_offering_bids_guard"() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'offering_bids is append-only (DELETE not allowed)' USING ERRCODE = 'raise_exception';
        END IF;
        -- immutable columns can never change
        IF NEW."id" <> OLD."id" OR NEW."offering_id" <> OLD."offering_id"
           OR NEW."collector_sub" <> OLD."collector_sub" OR NEW."collector_wallet" <> OLD."collector_wallet"
           OR NEW."price_stroops" <> OLD."price_stroops" OR NEW."count" <> OLD."count"
           OR NEW."idempotency_hash" <> OLD."idempotency_hash" OR NEW."created_at" <> OLD."created_at" THEN
          RAISE EXCEPTION 'offering_bids immutable columns cannot change' USING ERRCODE = 'raise_exception';
        END IF;
        -- soft-delete is final and one-way
        IF OLD."deleted_at" IS NOT NULL THEN
          RAISE EXCEPTION 'offering_bids soft-delete is final' USING ERRCODE = 'raise_exception';
        END IF;
        -- forward-only status machine (submit escrow + cancel refund); every other move is rejected
        IF OLD."status" <> NEW."status"
           AND NOT (
                (OLD."status" = 'submitted' AND NEW."status" IN ('escrowed','failed'))
             OR (OLD."status" = 'escrowed'  AND NEW."status" = 'canceling')
             OR (OLD."status" = 'canceling' AND NEW."status" IN ('canceled','escrowed'))
           ) THEN
          RAISE EXCEPTION 'offering_bids illegal status transition % -> %', OLD."status", NEW."status"
            USING ERRCODE = 'raise_exception';
        END IF;
        -- escrow stamps are write-once (never rewrite a landed chain id / tx hash)
        IF OLD."chain_bid_id" IS NOT NULL AND NEW."chain_bid_id" IS DISTINCT FROM OLD."chain_bid_id" THEN
          RAISE EXCEPTION 'offering_bids chain_bid_id is write-once' USING ERRCODE = 'raise_exception';
        END IF;
        IF OLD."escrow_tx_hash" IS NOT NULL AND NEW."escrow_tx_hash" IS DISTINCT FROM OLD."escrow_tx_hash" THEN
          RAISE EXCEPTION 'offering_bids escrow_tx_hash is write-once' USING ERRCODE = 'raise_exception';
        END IF;
        -- refund stamps are write-once (TOV-158)
        IF OLD."refund_tx_hash" IS NOT NULL AND NEW."refund_tx_hash" IS DISTINCT FROM OLD."refund_tx_hash" THEN
          RAISE EXCEPTION 'offering_bids refund_tx_hash is write-once' USING ERRCODE = 'raise_exception';
        END IF;
        IF OLD."canceled_at" IS NOT NULL AND NEW."canceled_at" IS DISTINCT FROM OLD."canceled_at" THEN
          RAISE EXCEPTION 'offering_bids canceled_at is write-once' USING ERRCODE = 'raise_exception';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    // 7) Split the two partial-unique index predicates (they no longer match). Transactional DROP+CREATE.
    //    Active-slot belt: holds the slot through `canceling`, frees on `canceled` (like `failed`).
    await queryRunner.query(`DROP INDEX "UQ_offering_bids_active_per_collector"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_offering_bids_active_per_collector"
        ON "offering_bids" ("offering_id", "collector_sub")
        WHERE "status" IN ('submitted','escrowed','canceling') AND "deleted_at" IS NULL
    `);
    //    Idem belt: INCLUDES `canceled` because submit_bid's on-chain Idem(key) is permanent (cancel_bid never
    //    clears it) — mirroring it keeps a same-key re-bid a clean DB 409 instead of an on-chain DuplicateBid
    //    strand. `failed` stays excluded (a failed bid never landed → its key was never set on-chain).
    await queryRunner.query(`DROP INDEX "UQ_offering_bids_idem"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_offering_bids_idem"
        ON "offering_bids" ("idempotency_hash")
        WHERE "status" IN ('submitted','escrowed','canceling','canceled') AND "deleted_at" IS NULL
    `);

    // 8) Plain btree so findMyActiveBid/findMyLatestBid get an Index Scan regardless of plan-cache mode
    //    (this append-only + soft-delete table grows unbounded; a generic plan must not Seq-Scan it). The
    //    trailing `created_at DESC, id DESC` lets findMyLatestBid's `ORDER BY created_at DESC, id DESC LIMIT 1`
    //    be fully index-ordered (no in-memory Sort node) — a collector can accumulate many terminal rows on one
    //    (collector, offering) pair via bid→cancel→re-bid, and this is the hot ~2s poll target. The `id` also
    //    provides a deterministic tiebreak under an exact created_at tie. findMyActiveBid (equality-only) is
    //    still fully served by the leading columns.
    await queryRunner.query(`
      CREATE INDEX "IDX_offering_bids_collector"
        ON "offering_bids" ("collector_sub", "offering_id", "created_at" DESC, "id" DESC)
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Fail CLOSED (see 036): the CLI revert path skips Joi validation, so NODE_ENV may be unset — treat
    // anything other than an explicit non-prod env as production.
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        `Refusing to revert AddOfferingBidCancelStates1716000000037 outside development/test (NODE_ENV=` +
          `${process.env.NODE_ENV ?? 'unset'}): "offering_bids" records real USDC refund provenance. ` +
          'Roll back the deployment instead.',
      );
    }
    await queryRunner.query(`SET lock_timeout = '3s'`);

    // 1) Restore the 036 three-state guard body FIRST (must not reference the columns we drop below). The
    //    body below is byte-for-byte identical to migration 036's fn_offering_bids_guard (incl. its comments).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "fn_offering_bids_guard"() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'offering_bids is append-only (DELETE not allowed)' USING ERRCODE = 'raise_exception';
        END IF;
        -- immutable columns can never change
        IF NEW."id" <> OLD."id" OR NEW."offering_id" <> OLD."offering_id"
           OR NEW."collector_sub" <> OLD."collector_sub" OR NEW."collector_wallet" <> OLD."collector_wallet"
           OR NEW."price_stroops" <> OLD."price_stroops" OR NEW."count" <> OLD."count"
           OR NEW."idempotency_hash" <> OLD."idempotency_hash" OR NEW."created_at" <> OLD."created_at" THEN
          RAISE EXCEPTION 'offering_bids immutable columns cannot change' USING ERRCODE = 'raise_exception';
        END IF;
        -- soft-delete is final and one-way
        IF OLD."deleted_at" IS NOT NULL THEN
          RAISE EXCEPTION 'offering_bids soft-delete is final' USING ERRCODE = 'raise_exception';
        END IF;
        -- forward-only status machine: submitted → escrowed | failed (no other move, no backward)
        IF OLD."status" <> NEW."status"
           AND NOT (OLD."status" = 'submitted' AND NEW."status" IN ('escrowed','failed')) THEN
          RAISE EXCEPTION 'offering_bids illegal status transition % -> %', OLD."status", NEW."status"
            USING ERRCODE = 'raise_exception';
        END IF;
        -- stamps are write-once (never rewrite a landed chain id / tx hash)
        IF OLD."chain_bid_id" IS NOT NULL AND NEW."chain_bid_id" IS DISTINCT FROM OLD."chain_bid_id" THEN
          RAISE EXCEPTION 'offering_bids chain_bid_id is write-once' USING ERRCODE = 'raise_exception';
        END IF;
        IF OLD."escrow_tx_hash" IS NOT NULL AND NEW."escrow_tx_hash" IS DISTINCT FROM OLD."escrow_tx_hash" THEN
          RAISE EXCEPTION 'offering_bids escrow_tx_hash is write-once' USING ERRCODE = 'raise_exception';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    // 2) Re-add the narrow status CHECK (validated) — ABORTS the whole revert if any canceling/canceled row
    //    exists, before any destructive drop. Fail-closed for a money table.
    await queryRunner.query(`ALTER TABLE "offering_bids" DROP CONSTRAINT "CHK_bid_status"`);
    await queryRunner.query(`
      ALTER TABLE "offering_bids" ADD CONSTRAINT "CHK_bid_status"
        CHECK ("status" IN ('submitted','escrowed','failed'))
    `);

    // 3) Restore the old index predicates.
    await queryRunner.query(`DROP INDEX "IDX_offering_bids_collector"`);
    await queryRunner.query(`DROP INDEX "UQ_offering_bids_idem"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_offering_bids_idem"
        ON "offering_bids" ("idempotency_hash")
        WHERE "status" IN ('submitted','escrowed') AND "deleted_at" IS NULL
    `);
    await queryRunner.query(`DROP INDEX "UQ_offering_bids_active_per_collector"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_offering_bids_active_per_collector"
        ON "offering_bids" ("offering_id", "collector_sub")
        WHERE "status" IN ('submitted','escrowed') AND "deleted_at" IS NULL
    `);

    // 4) Drop the refund CHECKs, then the columns.
    await queryRunner.query(`ALTER TABLE "offering_bids" DROP CONSTRAINT "CHK_bid_refund_clean"`);
    await queryRunner.query(`ALTER TABLE "offering_bids" DROP CONSTRAINT "CHK_bid_canceled_stamped"`);
    await queryRunner.query(`ALTER TABLE "offering_bids" DROP CONSTRAINT "CHK_bid_refund_txhash"`);
    await queryRunner.query(`
      ALTER TABLE "offering_bids"
        DROP COLUMN "canceled_at",
        DROP COLUMN "refund_tx_hash"
    `);
  }
}
