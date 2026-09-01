import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TOV-33 (PR #56 review, todo 432) — index the `/status` poll's "latest rotation for this source (any status)"
 * lookup: `source_wallet_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`
 * (`findLatestBySourceWithItems`). The existing `UQ_wrt_source_active` is partial on `status <> 'completed'`, so
 * it can't serve an all-status query — the poll would seq-scan a table that grows by one row per lifetime
 * rotation. This partial index covers it. New (empty) table in this PR → plain CREATE INDEX, no CONCURRENTLY.
 */
export class AddWalletRotationSourceLatestIndex1716000000056 implements MigrationInterface {
  name = 'AddWalletRotationSourceLatestIndex1716000000056';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(`
      CREATE INDEX "IDX_wrt_source_latest" ON "wallet_rotation_transfers"
        ("source_wallet_id", "created_at" DESC) WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_wrt_source_latest"`);
  }
}
