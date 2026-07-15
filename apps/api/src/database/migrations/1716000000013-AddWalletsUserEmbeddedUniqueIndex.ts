import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWalletsUserEmbeddedUniqueIndex1716000000013 implements MigrationInterface {
  name = 'AddWalletsUserEmbeddedUniqueIndex1716000000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enforce "at most one LIVE embedded-passkey wallet per user" at the DB level. This was only a
    // code assumption (TOV-22 code review #110): `findEmbeddedWalletByUserId` resolves the `from`
    // wallet for a money transfer, and without this a future add-second-passkey flow (or a
    // soft-delete/recreate race) could make that resolution non-deterministic. Partial index so
    // soft-deleted rows don't count (matches the `UQ_wallets_contract_address_active` pattern).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_wallets_user_embedded_active"
        ON "wallets" ("user_id")
        WHERE "kind" = 'embedded_passkey' AND "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_wallets_user_embedded_active"`);
  }
}
