import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasskeyRegistration1716000000012 implements MigrationInterface {
  name = 'AddPasskeyRegistration1716000000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // users: swap the email->password CHECK for its reverse. Passkey users have an
    // email but no password, which the old CHK_users_email_has_hash forbade. The
    // reverse (a password requires an email) still holds and is the useful invariant.
    // NOTE: "email account always has SOME credential" becomes an app-level invariant
    // (a single-table CHECK cannot see passkey_credentials) -- do not "restore" the old one.
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_email_has_hash"`);
    await queryRunner.query(`
      ALTER TABLE "users" ADD CONSTRAINT "CHK_users_password_needs_email"
        CHECK ("password_hash" IS NULL OR "email" IS NOT NULL) NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "users" VALIDATE CONSTRAINT "CHK_users_password_needs_email"`);

    // wallets: a Soroban smart wallet is a contract (C-address), not a G-address
    // account -- so public_key becomes nullable and contract_address is the passkey
    // wallet's identity. Column changes precede the CHECKs that reference them.
    await queryRunner.query(`ALTER TABLE "wallets" ALTER COLUMN "public_key" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "wallets" ADD COLUMN "contract_address" varchar(56)`);

    // Widen the kind CHECK (drop + re-add; a CHECK can't be altered in place). The new
    // predicate is a superset so VALIDATE is guaranteed to pass on existing byow rows.
    await queryRunner.query(`ALTER TABLE "wallets" DROP CONSTRAINT "CHK_wallets_kind"`);
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD CONSTRAINT "CHK_wallets_kind"
        CHECK ("kind" IN ('byow', 'embedded_passkey')) NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "wallets" VALIDATE CONSTRAINT "CHK_wallets_kind"`);

    // Per-kind field presence: byow has a public_key and no contract_address; passkey
    // has a contract_address and no public_key. Existing byow rows satisfy this.
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD CONSTRAINT "CHK_wallets_kind_fields"
        CHECK (
          ("kind" = 'byow'             AND "public_key" IS NOT NULL AND "contract_address" IS NULL)
          OR ("kind" = 'embedded_passkey' AND "contract_address" IS NOT NULL AND "public_key" IS NULL)
        ) NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "wallets" VALIDATE CONSTRAINT "CHK_wallets_kind_fields"`);

    // Global uniqueness of a deployed contract among live wallets.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_wallets_contract_address_active"
        ON "wallets" ("contract_address")
        WHERE "contract_address" IS NOT NULL AND "deleted_at" IS NULL
    `);

    // passkey_challenges: ephemeral WebAuthn registration challenges (no soft-delete;
    // single-use via consumed_at; swept on expiry). Mirrors auth_challenges.
    await queryRunner.query(`
      CREATE TABLE "passkey_challenges" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" citext NOT NULL,
        "challenge" text NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "consumed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_passkey_challenges" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_passkey_challenges_challenge" UNIQUE ("challenge")
      )
    `);
    // Only the outstanding (unconsumed) rows are queried by email (pruneOutstandingByEmail).
    await queryRunner.query(`
      CREATE INDEX "IDX_passkey_challenges_email_outstanding"
        ON "passkey_challenges" ("email")
        WHERE "consumed_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_passkey_challenges_expires_at"
        ON "passkey_challenges" ("expires_at")
    `);

    // passkey_credentials: the passkey signer bound to an embedded wallet (1:1).
    // Persistent + soft-deletable (wallet aggregate member).
    await queryRunner.query(`
      CREATE TABLE "passkey_credentials" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "wallet_id" uuid NOT NULL,
        "credential_id" text NOT NULL,
        "public_key" bytea NOT NULL,
        "counter" bigint NOT NULL DEFAULT 0,
        "transports" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_passkey_credentials" PRIMARY KEY ("id"),
        CONSTRAINT "FK_passkey_credentials_wallet_id" FOREIGN KEY ("wallet_id")
          REFERENCES "wallets" ("id") ON DELETE NO ACTION
      )
    `);
    // credential_id is globally unique among live rows (the AC + concurrency guard).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_passkey_credentials_credential_id_active"
        ON "passkey_credentials" ("credential_id")
        WHERE "deleted_at" IS NULL
    `);
    // One live credential per wallet (1:1 aggregate).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_passkey_credentials_wallet_id_active"
        ON "passkey_credentials" ("wallet_id")
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // DESTRUCTIVE by necessity: embedded_passkey wallets have a NULL public_key, so
    // restoring public_key NOT NULL (and the old users CHECK) requires deleting those
    // wallets + their passkey users first. FK-safe order + a precise predicate matter.
    await queryRunner.query(`DROP TABLE "passkey_credentials"`);
    await queryRunner.query(`DROP TABLE "passkey_challenges"`);

    // Snapshot passkey users BEFORE deleting wallets -- the wallet->user link is lost
    // once the rows are gone. Passkey users are uniquely (password_hash IS NULL AND
    // email IS NOT NULL) in this migration window; byow users (email NULL) are untouched.
    await queryRunner.query(`
      CREATE TEMP TABLE "_passkey_users" ON COMMIT DROP AS
        SELECT DISTINCT "user_id" FROM "wallets" WHERE "kind" = 'embedded_passkey'
    `);
    await queryRunner.query(`DELETE FROM "wallets" WHERE "kind" = 'embedded_passkey'`);
    // Precise predicate: passkey users are (password_hash NULL, email NOT NULL). The
    // NOT EXISTS guard also skips any user who still owns another (e.g. byow) wallet, so
    // this stays FK-safe even if a future flow attaches a passkey to an existing account.
    await queryRunner.query(`
      DELETE FROM "users"
      WHERE "id" IN (SELECT "user_id" FROM "_passkey_users")
        AND "password_hash" IS NULL AND "email" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "wallets" w WHERE w."user_id" = "users"."id")
    `);

    // Drop in dependency order: index -> per-kind CHECK -> widened kind CHECK -> column.
    await queryRunner.query(`DROP INDEX "UQ_wallets_contract_address_active"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP CONSTRAINT "CHK_wallets_kind_fields"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP CONSTRAINT "CHK_wallets_kind"`);
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD CONSTRAINT "CHK_wallets_kind"
        CHECK ("kind" IN ('byow')) NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "wallets" VALIDATE CONSTRAINT "CHK_wallets_kind"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "contract_address"`);
    await queryRunner.query(`ALTER TABLE "wallets" ALTER COLUMN "public_key" SET NOT NULL`);

    // Restore the original users CHECK (passkey users -- the only violators -- are gone).
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_password_needs_email"`);
    await queryRunner.query(`
      ALTER TABLE "users" ADD CONSTRAINT "CHK_users_email_has_hash"
        CHECK ("email" IS NULL OR "password_hash" IS NOT NULL) NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "users" VALIDATE CONSTRAINT "CHK_users_email_has_hash"`);
  }
}
