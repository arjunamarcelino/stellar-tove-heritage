import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TOV-177 (FR-06.04 + FR-06.05) — quote acceptance + atomic settlement schema. Two parts, ordered, in ONE
 * transaction (`migrationsTransactionMode:'each'`), so the parent ALTER and the child CREATE are atomic:
 *
 *   1. ALTER `rfq_quotes` — the seller-authorization columns (a seller pre-signs the accept_quote tuple; the
 *      signed `SorobanAuthorizationEntry` XDR is stored and replayed at accept), `status_reason` (why a quote
 *      lapsed), the `(id, rfq_id)` UNIQUE (composite-FK target for `secondary_trades`), the widened status
 *      CHECK (+`superseded`), and the re-declared `fn_quotes_guard` (adds the `open → superseded` transition;
 *      the new columns are intentionally NOT in the freeze list, so they stay mutable + re-authorizable).
 *   2. CREATE `secondary_trades` — one row per settled (or attempted) secondary trade. `gross_stroops` is a
 *      STORED generated column typed **unbounded `numeric`** (a `numeric(39,0)` product of two ~2^96 factors
 *      would raise 22003 before any CHECK), bounded to i128 by `CHK_trade_gross_max`. The partial-unique
 *      `UQ_secondary_trades_pending (rfq_id) WHERE status='pending'` is the double-accept latch; the guard is
 *      forward-only (`pending → settled|failed`) with write-once `tx_hash`/`settled_at`.
 *
 * DDL takes ACCESS EXCLUSIVE on `rfq_quotes` and HOLDS it to COMMIT — the CHECK re-scan, the `UQ_quotes_id_rfq`
 * index build, AND the whole `secondary_trades` create all run under it. That lock blocks READS as well as
 * writes, so `rfq_quotes` is briefly fully unavailable; `SET LOCAL lock_timeout` bounds only the WAIT to acquire
 * the lock, NOT the work held under it (there is no statement_timeout here). It is sub-second on today's small
 * table — deploy in a LOW-TRAFFIC window and gate on the row count first (see #388): if `rfq_quotes` has grown
 * large, split the CHECK (`ADD ... NOT VALID` + `VALIDATE`) and build `UQ_quotes_id_rfq` `CONCURRENTLY` to avoid
 * a read/write stall. DDL does NOT fire the ROW guard triggers.
 *
 *   Pre-deploy gate:  SELECT count(*) FROM rfq_quotes;  -- small (< ~100k) → ship as-is
 *                     SELECT status, count(*) FROM rfq_quotes GROUP BY status;  -- expect only the old 4 values
 */
export class AddSecondaryTradesAndSellerAuth1716000000045 implements MigrationInterface {
  name = 'AddSecondaryTradesAndSellerAuth1716000000045';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // SET LOCAL: auto-resets at COMMIT, so the ceiling can't leak onto a later migration on the shared conn.
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);

    // ── Part 1: rfq_quotes — seller-authorization columns + superseded status ──────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "rfq_quotes"
        ADD COLUMN "status_reason"            varchar(48),
        ADD COLUMN "seller_auth_entry"        bytea,
        ADD COLUMN "seller_auth_expires_ledger" bigint,
        ADD COLUMN "seller_wallet_contract"   varchar(56),
        ADD COLUMN "authorized_at"            timestamptz
    `);

    // Widen the status vocabulary. A CHECK cannot be altered in place → DROP + ADD. The ADD re-scans the table
    // under ACCESS EXCLUSIVE, but the new list is a SUPERSET of the old, so it cannot fail on existing rows.
    await queryRunner.query(`ALTER TABLE "rfq_quotes" DROP CONSTRAINT "CHK_quotes_status"`);
    await queryRunner.query(`
      ALTER TABLE "rfq_quotes" ADD CONSTRAINT "CHK_quotes_status"
        CHECK ("status" IN ('open','accepted','canceled','expired','superseded'))
    `);

    // Composite-FK target for secondary_trades.(quote_id, rfq_id) — pins a trade's quote to its RFQ. id is PK ⇒
    // every (id, rfq_id) pair is trivially distinct → this UNIQUE cannot fail on existing data.
    await queryRunner.query(`
      ALTER TABLE "rfq_quotes" ADD CONSTRAINT "UQ_quotes_id_rfq" UNIQUE ("id", "rfq_id")
    `);

    // Re-declare fn_quotes_guard: identical freeze list + delete/soft-delete blocks; ONLY change is the
    // forward-only whitelist gains `superseded`. The 5 new columns are absent from the freeze list ⇒ mutable
    // (auth cols writable + re-authorizable, status_reason writable).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "fn_quotes_guard"() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'rfq_quotes rows cannot be deleted' USING ERRCODE = 'raise_exception';
        END IF;
        IF NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at" THEN
          RAISE EXCEPTION 'rfq_quotes rows cannot be soft-deleted' USING ERRCODE = 'raise_exception';
        END IF;
        IF NEW."id" <> OLD."id" OR NEW."rfq_id" <> OLD."rfq_id" OR NEW."holder_sub" <> OLD."holder_sub"
           OR NEW."fraction_contract_id" <> OLD."fraction_contract_id"
           OR NEW."fraction_count" <> OLD."fraction_count"
           OR NEW."price_per_fraction_stroops" <> OLD."price_per_fraction_stroops"
           OR NEW."valid_until" <> OLD."valid_until"
           OR NEW."idempotency_key_hash" <> OLD."idempotency_key_hash"
           OR NEW."created_at" <> OLD."created_at" THEN
          RAISE EXCEPTION 'rfq_quotes immutable columns cannot change' USING ERRCODE = 'raise_exception';
        END IF;
        -- forward-only status machine: open → accepted|canceled|expired|superseded.
        IF OLD."status" <> NEW."status"
           AND NOT (OLD."status" = 'open' AND NEW."status" IN ('accepted','canceled','expired','superseded')) THEN
          RAISE EXCEPTION 'rfq_quotes illegal status transition % -> %', OLD."status", NEW."status"
            USING ERRCODE = 'raise_exception';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    // ── Part 2: secondary_trades ───────────────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "secondary_trades" (
        "id"                          uuid          NOT NULL DEFAULT gen_random_uuid(),
        "rfq_id"                      uuid          NOT NULL,
        "quote_id"                    uuid          NOT NULL,
        "buyer_sub"                   uuid          NOT NULL,
        "seller_sub"                  uuid          NOT NULL,
        "fraction_contract_id"        uuid          NOT NULL,
        "fraction_count"              numeric(39,0) NOT NULL,
        "price_per_fraction_stroops"  numeric(39,0) NOT NULL,
        -- Unbounded numeric (a numeric(39,0) product of two ~2^96 factors overflows → 22003 before any CHECK).
        "gross_stroops"               numeric
          GENERATED ALWAYS AS ("fraction_count" * "price_per_fraction_stroops") STORED,
        "status"                      varchar(16)   NOT NULL DEFAULT 'pending',
        "failure_reason"              varchar(48),
        "tx_hash"                     varchar(64),
        "settled_at"                  timestamptz,
        "idempotency_key_hash"        bytea         NOT NULL,
        "created_at"                  timestamptz   NOT NULL DEFAULT now(),
        "updated_at"                  timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"                  timestamptz,
        CONSTRAINT "PK_secondary_trades" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_trade_status" CHECK ("status" IN ('pending','settled','failed')),
        CONSTRAINT "CHK_trade_count"
          CHECK ("fraction_count" > 0 AND "fraction_count" <= 79228162514264337593543950335),
        CONSTRAINT "CHK_trade_price"
          CHECK ("price_per_fraction_stroops" > 0
                 AND "price_per_fraction_stroops" <= 79228162514264337593543950335),
        -- i128 ceiling on the settled amount (the on-chain gross_usdc is i128).
        CONSTRAINT "CHK_trade_gross_max"
          CHECK ("gross_stroops" <= 170141183460469231731687303715884105727),
        CONSTRAINT "CHK_trade_idem_len" CHECK (octet_length("idempotency_key_hash") = 32),
        -- Token anti-drift: proves the RFQ exists AND its fraction_contract_id matches (reuses UQ_rfqs_id_fc).
        CONSTRAINT "FK_trade_rfq_fc" FOREIGN KEY ("rfq_id", "fraction_contract_id")
          REFERENCES "rfqs" ("id", "fraction_contract_id") ON DELETE RESTRICT,
        -- Pairing anti-drift: proves the quote belongs to THIS rfq (reuses UQ_quotes_id_rfq).
        CONSTRAINT "FK_trade_quote_rfq" FOREIGN KEY ("quote_id", "rfq_id")
          REFERENCES "rfq_quotes" ("id", "rfq_id") ON DELETE RESTRICT
      )
    `);

    // Double-accept latch: at most one live (pending) trade per RFQ. Freed the instant the trade goes terminal.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_secondary_trades_pending" ON "secondary_trades" ("rfq_id")
        WHERE "status" = 'pending' AND "deleted_at" IS NULL
    `);
    // FULL unique dedup belt (survives soft-delete): the HTTP Idempotency-Key durable backstop.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_secondary_trades_idem"
        ON "secondary_trades" ("buyer_sub", "rfq_id", "idempotency_key_hash")
    `);
    // Poll target GET :id/accept/me — the ORDER BY (created_at DESC, id DESC) is in the index → no Sort node.
    await queryRunner.query(`
      CREATE INDEX "IDX_secondary_trades_me"
        ON "secondary_trades" ("buyer_sub", "rfq_id", "created_at" DESC, "id" DESC)
        WHERE "deleted_at" IS NULL
    `);
    // Reconcile sweep: stale pending trades, oldest-first. Self-shrinking (rows leave as they go terminal).
    await queryRunner.query(`
      CREATE INDEX "IDX_secondary_trades_stale" ON "secondary_trades" ("created_at")
        WHERE "status" = 'pending' AND "deleted_at" IS NULL
    `);

    // Guard: block delete/soft-delete; freeze money-intent + identity cols (NOT gross_stroops — a generated
    // col is unassignable, so freezing it is dead code; freeze its inputs). Write-once tx_hash/settled_at
    // (NULL→value allowed, incl. the adopt path; value→other rejected). Forward-only pending → settled|failed.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "fn_secondary_trades_guard"() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'secondary_trades rows cannot be deleted' USING ERRCODE = 'raise_exception';
        END IF;
        IF NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at" THEN
          RAISE EXCEPTION 'secondary_trades rows cannot be soft-deleted' USING ERRCODE = 'raise_exception';
        END IF;
        IF NEW."id" <> OLD."id" OR NEW."rfq_id" <> OLD."rfq_id" OR NEW."quote_id" <> OLD."quote_id"
           OR NEW."buyer_sub" <> OLD."buyer_sub" OR NEW."seller_sub" <> OLD."seller_sub"
           OR NEW."fraction_contract_id" <> OLD."fraction_contract_id"
           OR NEW."fraction_count" <> OLD."fraction_count"
           OR NEW."price_per_fraction_stroops" <> OLD."price_per_fraction_stroops"
           OR NEW."idempotency_key_hash" <> OLD."idempotency_key_hash"
           OR NEW."created_at" <> OLD."created_at" THEN
          RAISE EXCEPTION 'secondary_trades immutable columns cannot change' USING ERRCODE = 'raise_exception';
        END IF;
        IF OLD."tx_hash" IS NOT NULL AND NEW."tx_hash" IS DISTINCT FROM OLD."tx_hash" THEN
          RAISE EXCEPTION 'secondary_trades.tx_hash is write-once' USING ERRCODE = 'raise_exception';
        END IF;
        IF OLD."settled_at" IS NOT NULL AND NEW."settled_at" IS DISTINCT FROM OLD."settled_at" THEN
          RAISE EXCEPTION 'secondary_trades.settled_at is write-once' USING ERRCODE = 'raise_exception';
        END IF;
        -- forward-only status machine: pending → settled|failed.
        IF OLD."status" <> NEW."status"
           AND NOT (OLD."status" = 'pending' AND NEW."status" IN ('settled','failed')) THEN
          RAISE EXCEPTION 'secondary_trades illegal status transition % -> %', OLD."status", NEW."status"
            USING ERRCODE = 'raise_exception';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_secondary_trades_guard"
        BEFORE UPDATE OR DELETE ON "secondary_trades"
        FOR EACH ROW EXECUTE FUNCTION "fn_secondary_trades_guard"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Fail CLOSED outside dev/test: secondary_trades records real settled-trade money provenance.
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        `Refusing to revert AddSecondaryTradesAndSellerAuth1716000000045 outside development/test (NODE_ENV=` +
          `${process.env.NODE_ENV ?? 'unset'}): "secondary_trades" records real settled-trade provenance and ` +
          'stored seller authorizations. Roll back the deployment instead (redeploy previous commit).',
      );
    }
    // FK-safe drop order: child (secondary_trades + trigger + fn) FIRST, then revert the rfq_quotes changes
    // (narrowing CHK_quotes_status fails if any 'superseded' row exists — acceptable fail-closed in dev/test).
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_secondary_trades_guard" ON "secondary_trades"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "fn_secondary_trades_guard"()`);
    await queryRunner.query(`DROP TABLE IF EXISTS "secondary_trades"`);

    // Restore fn_quotes_guard to the pre-045 (TOV-175) body (drops the `superseded` transition).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "fn_quotes_guard"() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'rfq_quotes rows cannot be deleted' USING ERRCODE = 'raise_exception';
        END IF;
        IF NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at" THEN
          RAISE EXCEPTION 'rfq_quotes rows cannot be soft-deleted' USING ERRCODE = 'raise_exception';
        END IF;
        IF NEW."id" <> OLD."id" OR NEW."rfq_id" <> OLD."rfq_id" OR NEW."holder_sub" <> OLD."holder_sub"
           OR NEW."fraction_contract_id" <> OLD."fraction_contract_id"
           OR NEW."fraction_count" <> OLD."fraction_count"
           OR NEW."price_per_fraction_stroops" <> OLD."price_per_fraction_stroops"
           OR NEW."valid_until" <> OLD."valid_until"
           OR NEW."idempotency_key_hash" <> OLD."idempotency_key_hash"
           OR NEW."created_at" <> OLD."created_at" THEN
          RAISE EXCEPTION 'rfq_quotes immutable columns cannot change' USING ERRCODE = 'raise_exception';
        END IF;
        IF OLD."status" <> NEW."status"
           AND NOT (OLD."status" = 'open' AND NEW."status" IN ('accepted','canceled','expired')) THEN
          RAISE EXCEPTION 'rfq_quotes illegal status transition % -> %', OLD."status", NEW."status"
            USING ERRCODE = 'raise_exception';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`ALTER TABLE "rfq_quotes" DROP CONSTRAINT "CHK_quotes_status"`);
    await queryRunner.query(`
      ALTER TABLE "rfq_quotes" ADD CONSTRAINT "CHK_quotes_status"
        CHECK ("status" IN ('open','accepted','canceled','expired'))
    `);
    await queryRunner.query(`ALTER TABLE "rfq_quotes" DROP CONSTRAINT IF EXISTS "UQ_quotes_id_rfq"`);
    await queryRunner.query(`
      ALTER TABLE "rfq_quotes"
        DROP COLUMN IF EXISTS "authorized_at",
        DROP COLUMN IF EXISTS "seller_wallet_contract",
        DROP COLUMN IF EXISTS "seller_auth_expires_ledger",
        DROP COLUMN IF EXISTS "seller_auth_entry",
        DROP COLUMN IF EXISTS "status_reason"
    `);
  }
}
