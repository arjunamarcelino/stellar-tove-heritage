import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TOV-175 (FR-06.03) — the `rfq_quotes` table: a whitelisted holder's offer to SELL fractions in response to
 * an RFQ. Pure DB record at submit (no on-chain leg). Companion to `rfqs` (`1716000000041`).
 *
 * Two parts, ordered, in ONE transaction (`migrationsTransactionMode:'each'`), so the parent ALTER and the
 * child CREATE are atomic (no orphan-constraint state on failure):
 *   1. ADD `UQ_rfqs_id_fc UNIQUE (id, fraction_contract_id)` on the parent `rfqs` — the target the child's
 *      composite FK references. `id` is already `PK_rfqs`, so every `(id, fraction_contract_id)` pair is
 *      trivially distinct → the ADD UNIQUE cannot fail on existing data (mirrors `UQ_fc_artwork_id`, mig 033).
 *   2. CREATE `rfq_quotes` with CHECK belts, the composite anti-drift FK, the idempotency + active-per-RFQ
 *      unique indexes, the locked-sum index, and the immutability/forward-only guard trigger.
 *
 * NB: `ADD CONSTRAINT ... UNIQUE` takes ACCESS EXCLUSIVE on `rfqs` for the whole (sub-second) txn — deploy in
 * a low-write window. `SET LOCAL lock_timeout` bounds only the WAIT for the lock (bails cleanly on a long
 * in-flight write). DDL does NOT fire `fn_rfqs_guard` (a BEFORE UPDATE/DELETE ROW trigger).
 */
export class CreateRfqQuotesTable1716000000044 implements MigrationInterface {
  name = 'CreateRfqQuotesTable1716000000044';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // SET LOCAL: auto-resets at COMMIT (TypeORM wraps each migration in a txn), so the ceiling can't leak onto
    // a later migration on the shared migration:run connection.
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);

    // 1. Composite-FK target on the parent. id is PK ⇒ this UNIQUE is trivially satisfied by existing rows.
    await queryRunner.query(`
      ALTER TABLE "rfqs" ADD CONSTRAINT "UQ_rfqs_id_fc" UNIQUE ("id", "fraction_contract_id")
    `);

    // 2. The quotes table.
    await queryRunner.query(`
      CREATE TABLE "rfq_quotes" (
        "id"                          uuid          NOT NULL DEFAULT gen_random_uuid(),
        "rfq_id"                      uuid          NOT NULL,
        "holder_sub"                  uuid          NOT NULL,
        "fraction_contract_id"        uuid          NOT NULL,
        "fraction_count"              numeric(39,0) NOT NULL,
        "price_per_fraction_stroops"  numeric(39,0) NOT NULL,
        "valid_until"                 timestamptz   NOT NULL,
        "status"                      varchar(16)   NOT NULL DEFAULT 'open',
        "idempotency_key_hash"        bytea         NOT NULL,
        "created_at"                  timestamptz   NOT NULL DEFAULT now(),
        "updated_at"                  timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"                  timestamptz,
        CONSTRAINT "PK_rfq_quotes" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_quotes_status" CHECK ("status" IN ('open','accepted','canceled','expired')),
        CONSTRAINT "CHK_quotes_count"
          CHECK ("fraction_count" > 0 AND "fraction_count" <= 79228162514264337593543950335),
        CONSTRAINT "CHK_quotes_price"
          CHECK ("price_per_fraction_stroops" > 0
                 AND "price_per_fraction_stroops" <= 79228162514264337593543950335),
        CONSTRAINT "CHK_quotes_validity" CHECK ("valid_until" > "created_at"),
        CONSTRAINT "CHK_quotes_idem_len" CHECK (octet_length("idempotency_key_hash") = 32),
        -- Composite FK: proves the RFQ exists AND its snapshotted fraction_contract_id matches (anti-drift).
        CONSTRAINT "FK_quotes_rfq_fc" FOREIGN KEY ("rfq_id", "fraction_contract_id")
          REFERENCES "rfqs" ("id", "fraction_contract_id") ON DELETE RESTRICT
      )
    `);

    // FULL unique dedup belt (NOT partial): idempotency dedup must survive any soft-delete. Scope matches the
    // Redis key (per holder, per rfq, per key). This is the ON-CONFLICT target for insertOpen's .orIgnore.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_quotes_idem"
        ON "rfq_quotes" ("holder_sub", "rfq_id", "idempotency_key_hash")
    `);
    // One active (open) quote per (rfq, holder). Defense-in-depth; the advisory-locked pre-check is authoritative.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_quotes_active_per_rfq" ON "rfq_quotes" ("rfq_id", "holder_sub")
        WHERE "status" = 'open' AND "deleted_at" IS NULL
    `);
    // Serves the locked-sum + lazy-reap + active pre-check (holder+token, open set).
    await queryRunner.query(`
      CREATE INDEX "IDX_quotes_locked" ON "rfq_quotes" ("holder_sub", "fraction_contract_id")
        WHERE "status" = 'open' AND "deleted_at" IS NULL
    `);

    // Immutability + forward-only guard. Freezes money-intent columns, blocks delete/soft-delete, allows only
    // open → accepted|canceled|expired. status/updated_at stay mutable (reap, accept).
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
        -- forward-only status machine: open → accepted|canceled|expired.
        IF OLD."status" <> NEW."status"
           AND NOT (OLD."status" = 'open' AND NEW."status" IN ('accepted','canceled','expired')) THEN
          RAISE EXCEPTION 'rfq_quotes illegal status transition % -> %', OLD."status", NEW."status"
            USING ERRCODE = 'raise_exception';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_quotes_guard"
        BEFORE UPDATE OR DELETE ON "rfq_quotes"
        FOR EACH ROW EXECUTE FUNCTION "fn_quotes_guard"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Fail CLOSED outside dev/test: rfq_quotes records real sell-intent provenance.
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        `Refusing to revert CreateRfqQuotesTable1716000000044 outside development/test (NODE_ENV=` +
          `${process.env.NODE_ENV ?? 'unset'}): "rfq_quotes" records real sell-intent provenance. ` +
          'Roll back the deployment instead (redeploy previous commit; the additive rfqs UNIQUE is forward-safe).',
      );
    }
    // FK-safe drop order: child (table+trigger+fn) FIRST, then the parent UNIQUE the child FK depends on
    // (dropping UQ_rfqs_id_fc while FK_quotes_rfq_fc still references it errors 2BP01).
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_quotes_guard" ON "rfq_quotes"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "fn_quotes_guard"()`);
    await queryRunner.query(`DROP TABLE IF EXISTS "rfq_quotes"`);
    await queryRunner.query(`ALTER TABLE "rfqs" DROP CONSTRAINT IF EXISTS "UQ_rfqs_id_fc"`);
  }
}
