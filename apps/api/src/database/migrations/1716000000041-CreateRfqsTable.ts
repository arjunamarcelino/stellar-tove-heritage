import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Secondary-marketplace RFQ ledger (TOV-172, FR-06.01). One row per Request-for-Quote a whitelisted
 * Collector issues on a fractionalized artwork. Pure DB record — no on-chain leg — so, unlike the money
 * escrow tables, there is no generated escrow column; `max_price × fraction_count` is bounded in the
 * SERVICE (a clean 422) rather than persisted.
 *
 * Money-table conventions (mirror migration 036): `SET LOCAL lock_timeout` (SET LOCAL, not a plain SET,
 * so the 3s ceiling can't leak across TypeORM's shared `migration:run` connection — TOV-160 learning),
 * CHECK belts, and a fail-CLOSED `down()`.
 *
 * The composite FK `(artwork_id, fraction_contract_id) → fraction_contracts(artwork_id, id)` reuses the
 * EXISTING `UQ_fc_artwork_id` unique index (added in migration 033 for the offerings link) — it guarantees
 * the snapshotted contract belongs to the RFQ's artwork. It does NOT (and cannot) assert the contract is
 * still `deployed`/non-deleted; that follows from `CHK_fc_deployed_not_softdeleted` (028) + the service's
 * `deployed` gate. This migration therefore adds NO DDL to `fraction_contracts`.
 *
 * `UQ_rfqs_idem` is a FULL (non-partial) unique index so idempotency dedup survives even a hypothetical
 * soft-delete; `fn_rfqs_guard` additionally blocks delete/soft-delete and freezes the money-intent columns
 * while allowing `status` transitions (open → filled|canceled|expired). TRUNCATE (test teardown) does not
 * fire row triggers, so `truncateTables` still works.
 */
export class CreateRfqsTable1716000000041 implements MigrationInterface {
  name = 'CreateRfqsTable1716000000041';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // SET LOCAL: auto-resets at COMMIT (TypeORM wraps each migration in a txn), so it can't leak the 3s
    // ceiling onto a later migration on the shared connection. The FK below briefly locks artworks + fraction_contracts.
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);

    await queryRunner.query(`
      CREATE TABLE "rfqs" (
        "id"                             uuid          NOT NULL DEFAULT gen_random_uuid(),
        "collector_sub"                  uuid          NOT NULL,
        "artwork_id"                     uuid          NOT NULL,
        "fraction_contract_id"           uuid          NOT NULL,
        "fraction_count"                 numeric(39,0) NOT NULL,
        "max_price_per_fraction_stroops" numeric(39,0) NOT NULL,
        "expires_at"                     timestamptz   NOT NULL,
        "status"                         varchar(16)   NOT NULL DEFAULT 'open',
        "idempotency_key_hash"           bytea         NOT NULL,
        "created_at"                     timestamptz   NOT NULL DEFAULT now(),
        "updated_at"                     timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"                     timestamptz,
        CONSTRAINT "PK_rfqs" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_rfqs_status" CHECK ("status" IN ('open','filled','canceled','expired')),
        CONSTRAINT "CHK_rfqs_count"
          CHECK ("fraction_count" > 0 AND "fraction_count" <= 79228162514264337593543950335),
        CONSTRAINT "CHK_rfqs_price"
          CHECK ("max_price_per_fraction_stroops" > 0
                 AND "max_price_per_fraction_stroops" <= 79228162514264337593543950335),
        CONSTRAINT "CHK_rfqs_expiry" CHECK ("expires_at" > "created_at"),
        CONSTRAINT "CHK_rfqs_idem_len" CHECK (octet_length("idempotency_key_hash") = 32),
        -- Composite FK only: it guarantees the (artwork, contract) pairing AND artwork existence transitively
        -- (fraction_contracts.artwork_id → artworks), so a separate single-column FK on artwork_id would be a
        -- redundant second parent lock per insert. An RFQ always references a deployed contract, so this is safe.
        CONSTRAINT "FK_rfqs_artwork_fc" FOREIGN KEY ("artwork_id", "fraction_contract_id")
          REFERENCES "fraction_contracts" ("artwork_id", "id") ON DELETE RESTRICT
      )
    `);

    // FULL unique dedup belt (NOT partial): idempotency dedup must survive any soft-delete.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_rfqs_idem" ON "rfqs" ("collector_sub", "idempotency_key_hash")
    `);
    // Serves the per-collector active-open ceiling COUNT. UQ_rfqs_idem's leading collector_sub cannot serve it
    // efficiently (its 2nd column is the idem hash, not status), so without this the count would scan a
    // collector's ENTIRE lifetime RFQ history — terminal rows are never deleted (guard trigger), so they
    // accumulate. This partial index makes the count O(open) ≈ O(25).
    await queryRunner.query(`
      CREATE INDEX "IDX_rfqs_active_open" ON "rfqs" ("collector_sub")
        WHERE "status" = 'open' AND "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_rfqs_artwork" ON "rfqs" ("artwork_id") WHERE "deleted_at" IS NULL
    `);

    // Immutability + forward-only guard: block delete/soft-delete, freeze the money-intent columns, and allow
    // ONLY the forward status machine open → filled|canceled|expired (no backward/lateral moves). No code
    // writes status yet (create-only scope), but the DB backstop prevents a future bug from regressing a
    // terminal RFQ back to 'open'. Mirrors fn_offering_bids_guard.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "fn_rfqs_guard"() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'rfqs rows cannot be deleted' USING ERRCODE = 'raise_exception';
        END IF;
        IF NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at" THEN
          RAISE EXCEPTION 'rfqs rows cannot be soft-deleted' USING ERRCODE = 'raise_exception';
        END IF;
        IF NEW."id" <> OLD."id" OR NEW."collector_sub" <> OLD."collector_sub"
           OR NEW."artwork_id" <> OLD."artwork_id" OR NEW."fraction_contract_id" <> OLD."fraction_contract_id"
           OR NEW."fraction_count" <> OLD."fraction_count"
           OR NEW."max_price_per_fraction_stroops" <> OLD."max_price_per_fraction_stroops"
           OR NEW."idempotency_key_hash" <> OLD."idempotency_key_hash"
           OR NEW."expires_at" <> OLD."expires_at" OR NEW."created_at" <> OLD."created_at" THEN
          RAISE EXCEPTION 'rfqs immutable columns cannot change' USING ERRCODE = 'raise_exception';
        END IF;
        -- forward-only status machine: open → filled|canceled|expired (no backward, no terminal→terminal).
        IF OLD."status" <> NEW."status"
           AND NOT (OLD."status" = 'open' AND NEW."status" IN ('filled','canceled','expired')) THEN
          RAISE EXCEPTION 'rfqs illegal status transition % -> %', OLD."status", NEW."status"
            USING ERRCODE = 'raise_exception';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_rfqs_guard"
        BEFORE UPDATE OR DELETE ON "rfqs"
        FOR EACH ROW EXECUTE FUNCTION "fn_rfqs_guard"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Fail CLOSED: the CLI revert path (data-source.ts) does not run Joi validation, so NODE_ENV may be
    // unset — treat anything other than an explicit non-prod env as production.
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        `Refusing to revert CreateRfqsTable1716000000041 outside development/test (NODE_ENV=` +
          `${process.env.NODE_ENV ?? 'unset'}): "rfqs" records real buy-intent provenance. ` +
          'Roll back the deployment instead.',
      );
    }
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_rfqs_guard" ON "rfqs"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "fn_rfqs_guard"()`);
    // No fraction_contracts DDL was added (the FK reused the existing UQ_fc_artwork_id), so nothing to undo there.
    await queryRunner.query(`DROP TABLE IF EXISTS "rfqs"`);
  }
}
