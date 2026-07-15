import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plain (non-partial) index on `wallets.public_key` (TOV-24 review #148). The wallet-bind + login
 * reactivation paths look up by `public_key` **with soft-deleted rows included** (`withDeleted`), so the
 * query carries no `deleted_at IS NULL` predicate and cannot use the partial `UQ_wallets_public_key_active`
 * index — it would otherwise seq-scan `wallets` (once inside the bind write transaction, extending the lock
 * window). A full btree on `public_key` covers those lookups. Cheap: soft-deletes are rare, so it's nearly
 * the same cardinality as the partial unique index.
 */
export class AddWalletsPublicKeyIndex1716000000022 implements MigrationInterface {
  name = 'AddWalletsPublicKeyIndex1716000000022';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX "IDX_wallets_public_key" ON "wallets" ("public_key")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_wallets_public_key"`);
  }
}
