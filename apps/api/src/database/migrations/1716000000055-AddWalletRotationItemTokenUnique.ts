import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TOV-33 (PR #56 review, todo 428) — one item per (rotation, token). `initiate` has no Idempotency-Key, so
 * two concurrent initiates on the same source (serialized to ONE rotation by `UQ_wrt_source_active`) could
 * each load an empty item set and insert a duplicate item for the same token — which the per-item
 * `registry_events.source_ref` dedup cannot collapse, letting the append-only provenance ledger over-report
 * one on-chain transfer as two. This partial-unique index makes the duplicate insert fail (caught + re-read
 * by `upsertItemBuild`). Partial `WHERE deleted_at IS NULL` so a softCancel + fresh rotation can re-create
 * the same token.
 */
export class AddWalletRotationItemTokenUnique1716000000055 implements MigrationInterface {
  name = 'AddWalletRotationItemTokenUnique1716000000055';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_wrti_rotation_token" ON "wallet_rotation_transfer_items"
        ("rotation_id", "token_contract") WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_wrti_rotation_token"`);
  }
}
