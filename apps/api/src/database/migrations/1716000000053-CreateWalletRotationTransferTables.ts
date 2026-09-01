import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TOV-33 (FR-01.12) — the wallet-rotation holdings-transfer trackers: `wallet_rotation_transfers` (parent
 * header) + `wallet_rotation_transfer_items` (per-token transfer). Rotation moves ALL of a Collector's
 * FractionToken holdings from their embedded passkey wallet (source) to their own BYOW settlement wallet
 * (destination) as N single-op Soroban transfers, so it is non-atomic and tracked per-item for resume +
 * partial-failure safety (mirrors the export tracker, migration 1716000000016 — minus the token-kind axis
 * and the wallet `exported` latch).
 *
 * Status CHECK strings MUST mirror `rotation/rotation-status.types.ts`. All FKs are `ON DELETE NO ACTION`
 * (wallet removal is a SOFT unbind; users are never hard-deleted) so a wallet/user delete never silently
 * erases in-flight money-movement state. `down()` fails CLOSED outside dev/test — the item rows carry
 * in-flight on-chain `tx_hash` provenance + resume state.
 */
export class CreateWalletRotationTransferTables1716000000053 implements MigrationInterface {
  name = 'CreateWalletRotationTransferTables1716000000053';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);

    await queryRunner.query(`
      CREATE TABLE "wallet_rotation_transfers" (
        "id"                     uuid        NOT NULL DEFAULT gen_random_uuid(),
        "user_id"                uuid        NOT NULL,
        "source_wallet_id"       uuid        NOT NULL,
        "destination_wallet_id"  uuid        NOT NULL,
        "destination_address"    varchar(56) NOT NULL,
        "status"                 varchar(16) NOT NULL DEFAULT 'pending',
        "completed_at"           timestamptz,
        "created_at"             timestamptz NOT NULL DEFAULT now(),
        "updated_at"             timestamptz NOT NULL DEFAULT now(),
        "deleted_at"             timestamptz,
        CONSTRAINT "PK_wallet_rotation_transfers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_wrt_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE NO ACTION,
        CONSTRAINT "FK_wrt_source_wallet" FOREIGN KEY ("source_wallet_id")
          REFERENCES "wallets" ("id") ON DELETE NO ACTION,
        CONSTRAINT "FK_wrt_destination_wallet" FOREIGN KEY ("destination_wallet_id")
          REFERENCES "wallets" ("id") ON DELETE NO ACTION,
        CONSTRAINT "CHK_wrt_status" CHECK ("status" IN ('pending','submitting','completed','failed')),
        CONSTRAINT "CHK_wrt_completed_at" CHECK (("status" = 'completed') = ("completed_at" IS NOT NULL)),
        CONSTRAINT "CHK_wrt_distinct" CHECK ("source_wallet_id" <> "destination_wallet_id"),
        CONSTRAINT "CHK_wrt_dest_addr" CHECK ("destination_address" ~ '^[GC][A-Z2-7]{55}$')
      )
    `);

    // One active (non-completed) rotation per source wallet — the sole authoritative guard. The
    // `deleted_at IS NULL` predicate lets cancel/soft-delete clear the latch. Also serves the active lookup.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_wrt_source_active" ON "wallet_rotation_transfers"
        ("source_wallet_id") WHERE "status" <> 'completed' AND "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_wrt_user_id" ON "wallet_rotation_transfers" ("user_id") WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "wallet_rotation_transfer_items" (
        "id"                uuid        NOT NULL DEFAULT gen_random_uuid(),
        "rotation_id"       uuid        NOT NULL,
        "token_contract"    varchar(56) NOT NULL,
        "amount_scaled"     varchar(40) NOT NULL,
        "status"            varchar(16) NOT NULL DEFAULT 'pending',
        "unsigned_tx_xdr"   text,
        "expires_at_ledger" bigint,
        "tx_hash"           varchar(64),
        "ledger"            bigint,
        "last_error_code"   varchar(48),
        "created_at"        timestamptz NOT NULL DEFAULT now(),
        "updated_at"        timestamptz NOT NULL DEFAULT now(),
        "deleted_at"        timestamptz,
        CONSTRAINT "PK_wallet_rotation_transfer_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_wrti_rotation" FOREIGN KEY ("rotation_id")
          REFERENCES "wallet_rotation_transfers" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_wrti_status" CHECK ("status" IN ('pending','submitted','confirmed','failed')),
        CONSTRAINT "CHK_wrti_amount" CHECK ("amount_scaled" ~ '^[0-9]+$' AND "amount_scaled" <> '0'),
        CONSTRAINT "CHK_wrti_token" CHECK ("token_contract" ~ '^[GC][A-Z2-7]{55}$')
      )
    `);

    // A tx hash can confirm at most one item (allows many null-hash reconcile confirms). No
    // (confirmed <-> tx_hash) CHECK — crash-reconcile confirms with a null hash.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_wrti_tx_hash" ON "wallet_rotation_transfer_items"
        ("tx_hash") WHERE "tx_hash" IS NOT NULL AND "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_wrti_rotation_id" ON "wallet_rotation_transfer_items"
        ("rotation_id") WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        `Refusing to revert CreateWalletRotationTransferTables1716000000053 outside development/test ` +
          `(NODE_ENV=${process.env.NODE_ENV ?? 'unset'}): the item rows carry in-flight on-chain transfer ` +
          'state. Roll back the deployment instead.',
      );
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "wallet_rotation_transfer_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "wallet_rotation_transfers"`);
  }
}
