import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Export-table DB hardening (TOV-40, review todo 139). (1) Scope the wallet_exports/wallet_export_items
 * indexes to live rows (`WHERE deleted_at IS NULL`) per the project soft-delete rule — the repo reads all
 * rely on TypeORM's implicit `deleted_at IS NULL` filter, so the indexes must match. (2) Make the item ->
 * export FK `ON DELETE CASCADE` (an export item is an aggregate child with no independent identity).
 *
 * NOTE: no `(status='confirmed') = (tx_hash IS NOT NULL)` CHECK — the crash-recovery reconciliation (todo
 * 127) legitimately marks an item confirmed WITHOUT a tx hash (it was lost in the crash), so that
 * biconditional would be incorrect.
 */
export class HardenWalletExportIndexes1716000000018 implements MigrationInterface {
  name = 'HardenWalletExportIndexes1716000000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- Re-scope indexes to live rows ---
    await queryRunner.query(`DROP INDEX "IDX_wallet_exports_wallet_id"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_wallet_exports_wallet_id" ON "wallet_exports" ("wallet_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(`DROP INDEX "IDX_wallet_exports_user_id"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_wallet_exports_user_id" ON "wallet_exports" ("user_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(`DROP INDEX "IDX_wallet_export_items_export_id"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_wallet_export_items_export_id" ON "wallet_export_items" ("export_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(`DROP INDEX "IDX_wallet_export_items_status"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_wallet_export_items_status" ON "wallet_export_items" ("status") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(`DROP INDEX "UQ_wallet_export_items_tx_hash"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_wallet_export_items_tx_hash" ON "wallet_export_items" ("tx_hash") WHERE "tx_hash" IS NOT NULL AND "deleted_at" IS NULL`,
    );

    // --- Item FK: cascade from the parent export (aggregate child) ---
    await queryRunner.query(`ALTER TABLE "wallet_export_items" DROP CONSTRAINT "FK_wallet_export_items_export_id"`);
    await queryRunner.query(`
      ALTER TABLE "wallet_export_items" ADD CONSTRAINT "FK_wallet_export_items_export_id"
        FOREIGN KEY ("export_id") REFERENCES "wallet_exports" ("id") ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "wallet_export_items" DROP CONSTRAINT "FK_wallet_export_items_export_id"`);
    await queryRunner.query(`
      ALTER TABLE "wallet_export_items" ADD CONSTRAINT "FK_wallet_export_items_export_id"
        FOREIGN KEY ("export_id") REFERENCES "wallet_exports" ("id") ON DELETE NO ACTION
    `);

    await queryRunner.query(`DROP INDEX "UQ_wallet_export_items_tx_hash"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_wallet_export_items_tx_hash" ON "wallet_export_items" ("tx_hash") WHERE "tx_hash" IS NOT NULL`,
    );
    await queryRunner.query(`DROP INDEX "IDX_wallet_export_items_status"`);
    await queryRunner.query(`CREATE INDEX "IDX_wallet_export_items_status" ON "wallet_export_items" ("status")`);
    await queryRunner.query(`DROP INDEX "IDX_wallet_export_items_export_id"`);
    await queryRunner.query(`CREATE INDEX "IDX_wallet_export_items_export_id" ON "wallet_export_items" ("export_id")`);
    await queryRunner.query(`DROP INDEX "IDX_wallet_exports_user_id"`);
    await queryRunner.query(`CREATE INDEX "IDX_wallet_exports_user_id" ON "wallet_exports" ("user_id")`);
    await queryRunner.query(`DROP INDEX "IDX_wallet_exports_wallet_id"`);
    await queryRunner.query(`CREATE INDEX "IDX_wallet_exports_wallet_id" ON "wallet_exports" ("wallet_id")`);
  }
}
