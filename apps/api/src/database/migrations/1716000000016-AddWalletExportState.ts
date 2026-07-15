import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Export-embedded-wallet state (TOV-40): wallet `status`/`removed_at` (the one-way export latch) plus
 * the stateful, resumable N-transfer tracker (`wallet_exports` + `wallet_export_items`). Export is
 * non-atomic (Soroban = one op/tx), so per-item rows drive resume + partial-failure safety.
 *
 * All new tables/columns; this down() is non-destructive to pre-existing data (no temp-table dance).
 * CHECKs use NOT VALID → VALIDATE (matches 1716000000012); the VALIDATE on `wallets` is a
 * SHARE UPDATE EXCLUSIVE full scan that does not block reads/writes.
 */
export class AddWalletExportState1716000000016 implements MigrationInterface {
  name = 'AddWalletExportState1716000000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- wallets: export latch columns ---
    await queryRunner.query(`ALTER TABLE "wallets" ADD COLUMN "removed_at" timestamptz`);
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD COLUMN "status" varchar(16) NOT NULL DEFAULT 'active'`,
    );
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD CONSTRAINT "CHK_wallets_status"
        CHECK ("status" IN ('active', 'exported')) NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "wallets" VALIDATE CONSTRAINT "CHK_wallets_status"`);
    // status='exported' ⟺ removed_at set (can't drift under partial failures/retries).
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD CONSTRAINT "CHK_wallets_exported_removed_at"
        CHECK (("status" = 'exported') = ("removed_at" IS NOT NULL)) NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "wallets" VALIDATE CONSTRAINT "CHK_wallets_exported_removed_at"`);

    // --- wallet_exports (parent header) ---
    await queryRunner.query(`
      CREATE TABLE "wallet_exports" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "wallet_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "target_address" varchar(56) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_wallet_exports" PRIMARY KEY ("id"),
        CONSTRAINT "FK_wallet_exports_wallet_id" FOREIGN KEY ("wallet_id")
          REFERENCES "wallets" ("id") ON DELETE NO ACTION,
        CONSTRAINT "FK_wallet_exports_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE NO ACTION,
        CONSTRAINT "CHK_wallet_exports_status"
          CHECK ("status" IN ('pending', 'submitting', 'completed', 'failed')),
        CONSTRAINT "CHK_wallet_exports_completed_at"
          CHECK (("status" = 'completed') = ("completed_at" IS NOT NULL))
      )
    `);
    // At most one NON-completed export per wallet (a failed export is retried in place, so it must be
    // covered here — otherwise initiate would insert a duplicate).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_wallet_exports_wallet_active"
        ON "wallet_exports" ("wallet_id")
        WHERE "status" <> 'completed' AND "deleted_at" IS NULL
    `);
    // FK-column indexes (the partial-unique index above only covers non-completed rows).
    await queryRunner.query(`CREATE INDEX "IDX_wallet_exports_wallet_id" ON "wallet_exports" ("wallet_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_wallet_exports_user_id" ON "wallet_exports" ("user_id")`);

    // --- wallet_export_items (per-holding transfers) ---
    await queryRunner.query(`
      CREATE TABLE "wallet_export_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "export_id" uuid NOT NULL,
        "token_contract" varchar(56) NOT NULL,
        "token_kind" varchar(16) NOT NULL,
        "amount_scaled" varchar(40) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "unsigned_tx_xdr" text,
        "challenge" text,
        "expires_at_ledger" bigint,
        "tx_hash" varchar(64),
        "ledger" bigint,
        "last_error_code" varchar(48),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_wallet_export_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_wallet_export_items_export_id" FOREIGN KEY ("export_id")
          REFERENCES "wallet_exports" ("id") ON DELETE NO ACTION,
        CONSTRAINT "CHK_wallet_export_items_token_kind"
          CHECK ("token_kind" IN ('usdc', 'fraction')),
        CONSTRAINT "CHK_wallet_export_items_status"
          CHECK ("status" IN ('pending', 'submitted', 'confirmed', 'failed')),
        -- amount is replayed verbatim into a signed transfer: reject non-numeric / zero at the DB.
        CONSTRAINT "CHK_wallet_export_items_amount"
          CHECK ("amount_scaled" ~ '^[0-9]+$' AND "amount_scaled" <> '0')
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_wallet_export_items_export_id" ON "wallet_export_items" ("export_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_wallet_export_items_status" ON "wallet_export_items" ("status")`);
    // A tx hash can't confirm two transfers.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_wallet_export_items_tx_hash"
        ON "wallet_export_items" ("tx_hash")
        WHERE "tx_hash" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "wallet_export_items"`);
    await queryRunner.query(`DROP TABLE "wallet_exports"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP CONSTRAINT "CHK_wallets_exported_removed_at"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP CONSTRAINT "CHK_wallets_status"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "status"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "removed_at"`);
  }
}
