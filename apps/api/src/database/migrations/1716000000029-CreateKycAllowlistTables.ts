import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * On-chain KYC allowlist admin records (TOV-235, FR-04.MVP.03a).
 *
 * NOTE — NOT the same as the pre-existing `fraction_kyc_allowlist` (migration 1716000000014, TOV-40): that
 * is an off-chain list of export-destination addresses. These two tables mirror the on-chain KYCAllowlist
 * contract (TOV-141):
 *   - `kyc_allowlist_events` — append-only audit log, one row per processed item (BEFORE UPDATE/DELETE
 *     trigger enforces immutability, mirroring `1716000000017`). Grouped by `batch_id`.
 *   - `kyc_allowlist_state` — advisory, NON-authoritative mirror of `is_allowed`, keyed by wallet StrKey.
 *
 * Both are decoupled from `users` (wallet-scoped, no FK).
 */
export class CreateKycAllowlistTables1716000000029 implements MigrationInterface {
  name = 'CreateKycAllowlistTables1716000000029';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "kyc_allowlist_events" (
        "id"           uuid        NOT NULL DEFAULT gen_random_uuid(),
        "batch_id"     uuid        NOT NULL,
        "wallet"       char(56)    NOT NULL,
        "action"       varchar(8)  NOT NULL,
        "admin_id"     uuid        NOT NULL,
        "tx_hash"      char(64),
        "reason"       varchar(64),
        "result"       varchar(16) NOT NULL,
        "error_reason" varchar(500),
        "created_at"   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kyc_allowlist_events" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_kyc_allowlist_events_batch_item" UNIQUE ("batch_id", "wallet", "action"),
        CONSTRAINT "CHK_kae_wallet" CHECK ("wallet" ~ '^C[A-Z2-7]{55}$'),
        CONSTRAINT "CHK_kae_action" CHECK ("action" IN ('add','remove')),
        CONSTRAINT "CHK_kae_result" CHECK ("result" IN ('confirmed','pending','failed','noop','deferred')),
        CONSTRAINT "CHK_kae_tx_hash" CHECK ("tx_hash" IS NULL OR "tx_hash" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "CHK_kae_reason" CHECK ("reason" IS NULL OR "reason" ~ '^[a-z0-9_]{1,64}$'),
        CONSTRAINT "CHK_kae_error_reason_len" CHECK ("error_reason" IS NULL OR length("error_reason") <= 500),
        CONSTRAINT "CHK_kae_confirmed_has_hash" CHECK ("result" <> 'confirmed' OR "tx_hash" IS NOT NULL),
        CONSTRAINT "CHK_kae_hash_only_when_submitted" CHECK ("result" IN ('confirmed','pending') OR "tx_hash" IS NULL)
      )
    `);
    // "history of one wallet, newest last" + "fetch a batch" + insert-ordered time-series scan.
    await queryRunner.query(`CREATE INDEX "IDX_kae_wallet_created_at" ON "kyc_allowlist_events" ("wallet", "created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_kae_batch" ON "kyc_allowlist_events" ("batch_id")`);
    await queryRunner.query(`CREATE INDEX "BRIN_kae_created_at" ON "kyc_allowlist_events" USING brin ("created_at")`);

    // Append-only: a RAISEing BEFORE UPDATE OR DELETE trigger is role-agnostic (unlike REVOKE) and immutable
    // in fact. TRUNCATE fires only BEFORE TRUNCATE triggers, so test teardown (truncateTables) is unaffected.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "kyc_allowlist_events_immutable"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'kyc_allowlist_events is append-only (% not allowed)', TG_OP USING ERRCODE = 'raise_exception';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_kyc_allowlist_events_immutable"
        BEFORE UPDATE OR DELETE ON "kyc_allowlist_events"
        FOR EACH ROW EXECUTE FUNCTION "kyc_allowlist_events_immutable"()
    `);

    await queryRunner.query(`
      CREATE TABLE "kyc_allowlist_state" (
        "wallet"       char(56)    NOT NULL,
        "is_allowed"   boolean     NOT NULL,
        "last_action"  varchar(8)  NOT NULL,
        "last_tx_hash" char(64),
        "last_ledger"  bigint,
        "created_at"   timestamptz NOT NULL DEFAULT now(),
        "updated_at"   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kyc_allowlist_state" PRIMARY KEY ("wallet"),
        CONSTRAINT "CHK_kas_wallet" CHECK ("wallet" ~ '^C[A-Z2-7]{55}$'),
        CONSTRAINT "CHK_kas_last_action" CHECK ("last_action" IN ('add','remove')),
        CONSTRAINT "CHK_kas_last_tx_hash" CHECK ("last_tx_hash" IS NULL OR "last_tx_hash" ~ '^[0-9a-f]{64}$')
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Refusing to revert CreateKycAllowlistTables1716000000029 in production: "kyc_allowlist_events" ' +
          'records irreversible on-chain allowlist mutations. Roll back the deployment instead.',
      );
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "kyc_allowlist_state"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_kyc_allowlist_events_immutable" ON "kyc_allowlist_events"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "kyc_allowlist_events_immutable"()`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kyc_allowlist_events"`);
  }
}
