import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supporting index for the TOV-154 admin approval work-queue read (`GET /offerings`, todo 286). The
 * `listForBackoffice` finder runs `WHERE status IN (...) AND deleted_at IS NULL ORDER BY created_at DESC`
 * (+ a COUNT) on the `offerings` table, which grows unbounded (terminal `settled`/`canceled` rows are never
 * removed). Neither existing offerings index (`UQ_offerings_active_per_artwork` on `artwork_id`,
 * `IDX_off_approved_open_due` on `window_open_at`) serves this filter+sort, so both the page and the count
 * seq-scanned + top-N sorted. Migration 032 explicitly deferred this to "the FR that first adds an
 * offerings list" — TOV-154 is that FR.
 *
 * Composite partial `(status, created_at DESC) WHERE deleted_at IS NULL`: the `status` prefix serves the
 * count and the status-narrowed queue; `created_at DESC` provides the sort (MergeAppend across the active
 * status set). Index-only migration — the `down()` simply drops it (safe/reversible, no money data).
 */
export class AddOfferingsListIndex1716000000035 implements MigrationInterface {
  name = 'AddOfferingsListIndex1716000000035';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_offerings_list" ON "offerings" ("status", "created_at" DESC) WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_offerings_list"`);
  }
}
