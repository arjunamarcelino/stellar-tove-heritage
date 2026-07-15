import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop the write-only `wallet_export_items.challenge` column (TOV-40, review todo 140). It was persisted
 * at build time but never read back — the API responses always emit the FRESH challenge from the relayer
 * build (initiate/resume rebuild), and submit verifies the assertion against the stored `unsigned_tx_xdr`,
 * not the stored challenge. So the column had no reader.
 */
export class DropExportItemChallenge1716000000019 implements MigrationInterface {
  name = 'DropExportItemChallenge1716000000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "wallet_export_items" DROP COLUMN "challenge"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "wallet_export_items" ADD COLUMN "challenge" text`);
  }
}
