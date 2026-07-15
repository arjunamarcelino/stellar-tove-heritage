import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWalletsAndAuthChallenges1716000000011 implements MigrationInterface {
  name = 'AddWalletsAndAuthChallenges1716000000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // BYOW wallet login: a wallet may exist without email/password, so relax the
    // users constraints. wallets.public_key is the sole wallet store.
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL`);
    // Two-step so the expensive validation scan runs under SHARE UPDATE EXCLUSIVE
    // (concurrent DML allowed) instead of holding ACCESS EXCLUSIVE on `users` for
    // a full-table scan. ADD ... NOT VALID only writes the catalog entry (brief
    // lock, no scan); VALIDATE then checks existing rows without blocking writes.
    await queryRunner.query(`
      ALTER TABLE "users" ADD CONSTRAINT "CHK_users_email_has_hash"
        CHECK ("email" IS NULL OR "password_hash" IS NOT NULL) NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "users" VALIDATE CONSTRAINT "CHK_users_email_has_hash"`);

    // wallets: one User -> many wallets; public_key globally unique. varchar (NOT
    // citext) because Stellar StrKey is case-sensitive.
    await queryRunner.query(`
      CREATE TABLE "wallets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "public_key" varchar(56) NOT NULL,
        "kind" varchar(16) NOT NULL DEFAULT 'byow',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_wallets" PRIMARY KEY ("id"),
        CONSTRAINT "FK_wallets_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE NO ACTION,
        CONSTRAINT "CHK_wallets_kind" CHECK ("kind" IN ('byow'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_wallets_public_key_active"
        ON "wallets" ("public_key")
        WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_wallets_user_id"
        ON "wallets" ("user_id")
        WHERE "deleted_at" IS NULL
    `);

    // auth_challenges: ephemeral SEP-10 challenges (no soft-delete; swept on expiry).
    await queryRunner.query(`
      CREATE TABLE "auth_challenges" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "public_key" varchar(56) NOT NULL,
        "tx_hash" varchar(64) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "consumed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_auth_challenges" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_auth_challenges_tx_hash" UNIQUE ("tx_hash")
      )
    `);
    // Partial index over LIVE (unconsumed) rows only: the sole public_key query
    // is pruneOutstanding (public_key = ? AND consumed_at IS NULL), so scoping the
    // index to unconsumed rows keeps it small and avoids scanning consumed rows
    // when a sweep lags.
    await queryRunner.query(`
      CREATE INDEX "IDX_auth_challenges_public_key_outstanding"
        ON "auth_challenges" ("public_key")
        WHERE "consumed_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_auth_challenges_expires_at"
        ON "auth_challenges" ("expires_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // NOTE: this revert is DESTRUCTIVE by necessity. BYOW wallet-only users have
    // NULL email/password_hash, so `SET NOT NULL` cannot be restored while they
    // exist. We therefore drop the wallet tables FIRST (releasing the FK), then
    // delete the now-unreferenced wallet-only users, then restore NOT NULL. This
    // deletes wallet data + wallet-only accounts — intended only for a full rollback.
    await queryRunner.query(`DROP INDEX "IDX_auth_challenges_expires_at"`);
    await queryRunner.query(`DROP INDEX "IDX_auth_challenges_public_key_outstanding"`);
    await queryRunner.query(`DROP TABLE "auth_challenges"`);
    await queryRunner.query(`DROP INDEX "IDX_wallets_user_id"`);
    await queryRunner.query(`DROP INDEX "UQ_wallets_public_key_active"`);
    await queryRunner.query(`DROP TABLE "wallets"`);

    // Remove wallet-only users (email + password_hash both NULL) so the columns
    // can be made NOT NULL again. The CHECK guarantees password_hash IS NULL only
    // for such accounts, so this predicate is precise.
    await queryRunner.query(`DELETE FROM "users" WHERE "password_hash" IS NULL`);

    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_email_has_hash"`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "password_hash" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL`);
  }
}
