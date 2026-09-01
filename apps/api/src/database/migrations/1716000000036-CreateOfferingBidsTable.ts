import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Primary-Offering bid ledger (TOV-156, FR-05.03). One row per bid a whitelisted Collector places on an
 * `opened` offering; the async worker escrows `price × count` USDC into the offering's OfferingEscrow
 * contract via the passkey-signed `submit_bid`. Money table → same conventions as migration 034:
 * `SET lock_timeout`, CHECK belts, partial-unique + partial indexes (`WHERE deleted_at IS NULL`), a
 * SELECTIVE append-only-ish trigger, and a fail-CLOSED `down()`.
 *
 * `escrow_amount_stroops` is a STORED GENERATED column (`price_stroops * count`) — the app never writes it,
 * so a wrong escrow amount is structurally impossible. Typed unbounded `numeric` so an over-range product
 * fails `CHK_bid_escrow_cap` (23514) cleanly rather than a raw numeric overflow (22003). `MAX_STROOPS`
 * (2^96−1) is the on-chain USDC amount ceiling, shared with the offerings band CHECKs.
 *
 * The guard trigger (`fn_offering_bids_guard`) blocks hard DELETE, freezes the immutable columns, makes
 * soft-delete one-way, enforces a FORWARD-ONLY status machine (`submitted → escrowed|failed`), and makes
 * `chain_bid_id`/`escrow_tx_hash` write-once. TRUNCATE (test teardown) does not fire row triggers, so
 * `truncateTables` still works. `escrow_amount_stroops` is NOT in the immutable comparison because a
 * generated column is NULL during a BEFORE trigger; its immutability follows from freezing price/count.
 *
 * `canceled` is intentionally absent from `CHK_bid_status` this ticket (cancel_bid is a later FR).
 */
export class CreateOfferingBidsTable1716000000036 implements MigrationInterface {
  name = 'CreateOfferingBidsTable1716000000036';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fail fast rather than stall behind a long lock (the FK below briefly locks the money "offerings" table).
    await queryRunner.query(`SET lock_timeout = '3s'`);

    await queryRunner.query(`
      CREATE TABLE "offering_bids" (
        "id"                    uuid          NOT NULL DEFAULT gen_random_uuid(),
        "offering_id"           uuid          NOT NULL,
        "collector_sub"         uuid          NOT NULL,
        "collector_wallet"      char(56)      NOT NULL,
        "price_stroops"         numeric(39,0) NOT NULL,
        "count"                 numeric(39,0) NOT NULL,
        "escrow_amount_stroops" numeric       GENERATED ALWAYS AS ("price_stroops" * "count") STORED,
        "status"                varchar(16)   NOT NULL DEFAULT 'submitted',
        "chain_bid_id"          bigint,
        "escrow_tx_hash"        char(64),
        "idempotency_hash"      bytea         NOT NULL,
        "created_at"            timestamptz   NOT NULL DEFAULT now(),
        "updated_at"            timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"            timestamptz,
        CONSTRAINT "PK_offering_bids" PRIMARY KEY ("id"),
        CONSTRAINT "FK_offering_bids_offering" FOREIGN KEY ("offering_id")
          REFERENCES "offerings" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_bid_status" CHECK ("status" IN ('submitted','escrowed','failed')),
        CONSTRAINT "CHK_bid_price"
          CHECK ("price_stroops" > 0 AND "price_stroops" <= 79228162514264337593543950335),
        CONSTRAINT "CHK_bid_count"
          CHECK ("count" > 0 AND "count" <= 79228162514264337593543950335),
        CONSTRAINT "CHK_bid_escrow_cap"
          CHECK ("escrow_amount_stroops" <= 79228162514264337593543950335),
        CONSTRAINT "CHK_bid_wallet" CHECK ("collector_wallet" ~ '^C[A-Z2-7]{55}$'),
        CONSTRAINT "CHK_bid_txhash"
          CHECK ("escrow_tx_hash" IS NULL OR "escrow_tx_hash" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "CHK_bid_chain_id_positive" CHECK ("chain_bid_id" IS NULL OR "chain_bid_id" > 0),
        CONSTRAINT "CHK_bid_idem_len" CHECK (octet_length("idempotency_hash") = 32),
        CONSTRAINT "CHK_bid_escrowed_stamped"
          CHECK ("status" <> 'escrowed' OR ("chain_bid_id" IS NOT NULL AND "escrow_tx_hash" IS NOT NULL)),
        CONSTRAINT "CHK_bid_unescrowed_clean"
          CHECK ("status" NOT IN ('submitted','failed') OR ("chain_bid_id" IS NULL AND "escrow_tx_hash" IS NULL))
      )
    `);

    // One active (submitted|escrowed) bid per (offering, collector); 'failed' frees the slot for a re-bid.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_offering_bids_active_per_collector"
        ON "offering_bids" ("offering_id", "collector_sub")
        WHERE "status" IN ('submitted','escrowed') AND "deleted_at" IS NULL
    `);
    // DB-level dedupe belt mirroring the contract's on-chain Idem guard: a given idem hash is recorded iff
    // in-flight or landed. Excludes 'failed' (never landed → the same HTTP key may be legitimately re-prepared).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_offering_bids_idem"
        ON "offering_bids" ("idempotency_hash")
        WHERE "status" IN ('submitted','escrowed') AND "deleted_at" IS NULL
    `);
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
    await queryRunner.query(`
      CREATE TRIGGER "trg_offering_bids_guard"
        BEFORE UPDATE OR DELETE ON "offering_bids"
        FOR EACH ROW EXECUTE FUNCTION "fn_offering_bids_guard"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Fail CLOSED: the CLI revert path (data-source.ts) does not run Joi validation, so NODE_ENV may be
    // unset — treat anything other than an explicit non-prod env as production (todo 261).
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        `Refusing to revert CreateOfferingBidsTable1716000000036 outside development/test (NODE_ENV=` +
          `${process.env.NODE_ENV ?? 'unset'}): "offering_bids" records real USDC escrow provenance. ` +
          'Roll back the deployment instead.',
      );
    }
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_offering_bids_guard" ON "offering_bids"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "fn_offering_bids_guard"()`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_offering_bids_idem"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_offering_bids_active_per_collector"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "offering_bids"`);
  }
}
