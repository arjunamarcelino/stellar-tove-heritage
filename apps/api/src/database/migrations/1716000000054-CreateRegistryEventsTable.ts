import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TOV-33 (FR-01.12) — the append-only `registry_events` on-chain provenance ledger. One `custody_transfer`
 * row per confirmed FractionToken transfer during a wallet rotation (from = source wallet contract, to =
 * destination BYOW G-address). Modeled on `internal_audit_log` (append-only, no BaseEntity/soft-delete): a
 * BEFORE UPDATE OR DELETE trigger rejects all mutation.
 *
 * `source_ref` (`rotation_item:{itemId}`) has a FULL (non-partial) unique index so a bare
 * `ON CONFLICT (source_ref) DO NOTHING` insert can infer the arbiter → exactly one row per confirmed
 * transfer, idempotent under replay + crash-reconcile. FKs are `ON DELETE NO ACTION` — a cascade would erase
 * immutable provenance (and trip the trigger). `down()` fails CLOSED outside dev/test (dropping the ledger is
 * real provenance loss).
 */
export class CreateRegistryEventsTable1716000000054 implements MigrationInterface {
  name = 'CreateRegistryEventsTable1716000000054';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);

    await queryRunner.query(`
      CREATE TABLE "registry_events" (
        "id"                     uuid          NOT NULL DEFAULT gen_random_uuid(),
        "event_type"             varchar(32)   NOT NULL,
        "user_id"                uuid          NOT NULL,
        "source_wallet_id"       uuid          NOT NULL,
        "destination_wallet_id"  uuid          NOT NULL,
        "from_address"           varchar(56)   NOT NULL,
        "to_address"             varchar(56)   NOT NULL,
        "token_contract"         varchar(56)   NOT NULL,
        "amount_scaled"          numeric(39,0) NOT NULL,
        "tx_hash"                varchar(64),
        "ledger"                 bigint,
        "source_ref"             varchar(128)  NOT NULL,
        "created_at"             timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_registry_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_re_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE NO ACTION,
        CONSTRAINT "FK_re_source_wallet" FOREIGN KEY ("source_wallet_id")
          REFERENCES "wallets" ("id") ON DELETE NO ACTION,
        CONSTRAINT "FK_re_destination_wallet" FOREIGN KEY ("destination_wallet_id")
          REFERENCES "wallets" ("id") ON DELETE NO ACTION,
        CONSTRAINT "CHK_re_event_type" CHECK ("event_type" IN ('custody_transfer')),
        CONSTRAINT "CHK_re_amount" CHECK ("amount_scaled" > 0),
        CONSTRAINT "CHK_re_from_addr" CHECK ("from_address" ~ '^[GC][A-Z2-7]{55}$'),
        CONSTRAINT "CHK_re_to_addr" CHECK ("to_address" ~ '^[GC][A-Z2-7]{55}$'),
        CONSTRAINT "CHK_re_token" CHECK ("token_contract" ~ '^[GC][A-Z2-7]{55}$')
      )
    `);

    // FULL unique (not partial) so `ON CONFLICT (source_ref) DO NOTHING` infers it → one row per transfer.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_registry_events_source_ref" ON "registry_events" ("source_ref")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_registry_events_user" ON "registry_events" ("user_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_registry_events_created_brin" ON "registry_events" USING BRIN ("created_at")
    `);

    // Append-only: reject every UPDATE/DELETE (mirrors internal_audit_log's immutable trigger).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "fn_registry_events_guard"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'registry_events is append-only (% not allowed)', TG_OP
          USING ERRCODE = 'raise_exception';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_registry_events_guard"
        BEFORE UPDATE OR DELETE ON "registry_events"
        FOR EACH ROW EXECUTE FUNCTION "fn_registry_events_guard"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        `Refusing to revert CreateRegistryEventsTable1716000000054 outside development/test (NODE_ENV=` +
          `${process.env.NODE_ENV ?? 'unset'}): dropping the append-only registry is provenance loss. ` +
          'Roll back the deployment instead.',
      );
    }
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_registry_events_guard" ON "registry_events"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "fn_registry_events_guard"()`);
    await queryRunner.query(`DROP TABLE IF EXISTS "registry_events"`);
  }
}
