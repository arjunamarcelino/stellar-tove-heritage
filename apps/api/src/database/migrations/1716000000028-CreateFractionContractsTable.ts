import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-artwork FractionToken deploy records (TOV-233, FR-04.MVP.01). One row per fractionalization
 * attempt. The partial-unique index EXCLUDES `failed` so a new-key retry can insert a fresh row; a
 * `deployed` row can never be soft-deleted (`CHK_fc_deployed_not_softdeleted`) so it can never fall out
 * of that index and permit a duplicate on-chain deploy. `ON DELETE RESTRICT` guards hard-deletes; a
 * `BEFORE UPDATE` trigger guards SOFT-deletes of an artwork with a live token. (Deletion vectors:
 * soft-delete → this trigger; hard-delete → the inbound `ON DELETE RESTRICT` FK; TRUNCATE is out of
 * scope — a row-level trigger doesn't fire on TRUNCATE, but the inbound FK makes `TRUNCATE artworks`
 * error unless `fraction_contracts` is truncated too.)
 */
export class CreateFractionContractsTable1716000000028 implements MigrationInterface {
  name = 'CreateFractionContractsTable1716000000028';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "fraction_contracts" (
        "id"                        uuid          NOT NULL DEFAULT gen_random_uuid(),
        "artwork_id"                uuid          NOT NULL,
        "status"                    varchar(16)   NOT NULL DEFAULT 'deploying',
        "token_address"             char(56),
        "wasm_hash"                 char(64)      NOT NULL,
        "token_name"                varchar(32)   NOT NULL,
        "token_symbol"              varchar(12)   NOT NULL,
        "artist_address"            varchar(56)   NOT NULL,
        "total_supply"              numeric(39,0) NOT NULL,
        "artist_retention_pct"      int           NOT NULL,
        "treasury_retention_pct"    int           NOT NULL,
        "artist_retention_amount"   numeric(39,0),
        "treasury_retention_amount" numeric(39,0),
        "artist_lockup_days"        int           NOT NULL,
        "treasury_lockup_days"      int           NOT NULL,
        "tx_hash"                   char(64),
        "deploy_ledger"             bigint,
        "created_at"                timestamptz   NOT NULL DEFAULT now(),
        "updated_at"                timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"                timestamptz,
        CONSTRAINT "PK_fraction_contracts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_fraction_contracts_artwork" FOREIGN KEY ("artwork_id")
          REFERENCES "artworks" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_fc_status" CHECK ("status" IN ('deploying','deployed','failed')),
        CONSTRAINT "CHK_fc_token_address" CHECK ("token_address" IS NULL OR "token_address" ~ '^C[A-Z2-7]{55}$'),
        CONSTRAINT "CHK_fc_wasm_hash" CHECK ("wasm_hash" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "CHK_fc_symbol" CHECK ("token_symbol" ~ '^[A-Z0-9]{2,12}$'),
        CONSTRAINT "CHK_fc_name_nonempty" CHECK (length(btrim("token_name")) BETWEEN 1 AND 32),
        CONSTRAINT "CHK_fc_artist_address" CHECK ("artist_address" ~ '^[GC][A-Z2-7]{55}$'),
        CONSTRAINT "CHK_fc_pct" CHECK (
          "artist_retention_pct" BETWEEN 0 AND 100 AND
          "treasury_retention_pct" BETWEEN 0 AND 100 AND
          "artist_retention_pct" + "treasury_retention_pct" <= 100),
        CONSTRAINT "CHK_fc_supply" CHECK ("total_supply" > 0 AND "total_supply" <= 79228162514264337593543950335),
        CONSTRAINT "CHK_fc_lockup" CHECK ("artist_lockup_days" >= 0 AND "treasury_lockup_days" >= 0),
        CONSTRAINT "CHK_fc_retention_amounts" CHECK (
          COALESCE("artist_retention_amount",0) >= 0 AND COALESCE("treasury_retention_amount",0) >= 0 AND
          COALESCE("artist_retention_amount",0) + COALESCE("treasury_retention_amount",0) <= "total_supply"),
        CONSTRAINT "CHK_fc_deployed_has_address" CHECK ("status" <> 'deployed' OR "token_address" IS NOT NULL),
        CONSTRAINT "CHK_fc_deployed_not_softdeleted" CHECK (NOT ("status" = 'deployed' AND "deleted_at" IS NOT NULL))
      )
    `);

    // Authoritative "one active token per artwork"; EXCLUDES failed so retry-after-failure works.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_fraction_contracts_active_per_artwork"
        ON "fraction_contracts" ("artwork_id")
        WHERE "status" IN ('deploying','deployed') AND "deleted_at" IS NULL
    `);
    // Sweeper scan is O(in-flight): only 'deploying' rows are indexed, oldest first.
    await queryRunner.query(`
      CREATE INDEX "IDX_fc_deploying_created_at"
        ON "fraction_contracts" ("created_at")
        WHERE "status" = 'deploying' AND "deleted_at" IS NULL
    `);

    // ON DELETE RESTRICT does nothing for a SOFT delete, so guard artwork soft-deletes explicitly:
    // an artwork with a live (deploying|deployed) token can't be retired (would orphan the token).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "fn_block_artwork_softdelete_with_live_fc"()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."deleted_at" IS NOT NULL AND OLD."deleted_at" IS NULL THEN
          IF EXISTS (
            SELECT 1 FROM "fraction_contracts" fc
            WHERE fc."artwork_id" = NEW."id"
              AND fc."deleted_at" IS NULL
              AND fc."status" IN ('deploying','deployed')
          ) THEN
            RAISE EXCEPTION 'cannot soft-delete artwork % with a live fraction_contract', NEW."id"
              USING ERRCODE = 'raise_exception';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_block_artwork_softdelete_with_live_fc"
        BEFORE UPDATE ON "artworks"
        FOR EACH ROW EXECUTE FUNCTION "fn_block_artwork_softdelete_with_live_fc"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Fail CLOSED: the CLI revert path (data-source.ts) does not run Joi validation, so NODE_ENV may be
    // unset — treat anything other than an explicit non-prod env as production (todo 261).
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        `Refusing to revert CreateFractionContractsTable1716000000028 outside development/test (NODE_ENV=` +
          `${process.env.NODE_ENV ?? 'unset'}): "fraction_contracts" records irreversible on-chain token ` +
          'deploys. Roll back the deployment instead.',
      );
    }
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_block_artwork_softdelete_with_live_fc" ON "artworks"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "fn_block_artwork_softdelete_with_live_fc"()`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fc_deploying_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_fraction_contracts_active_per_artwork"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "fraction_contracts"`);
  }
}
