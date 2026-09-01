import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Primary-offering planning records (TOV-152, FR-05.01). One durable row per Offering, created in the
 * `planned` state; later M05 FRs move it through `approved → opened → subscribed → settled` (+ terminal
 * `canceled`). The `public_float` is snapshotted at planning from the deployed `fraction_contracts` row
 * the offering references (`fraction_contract_id`), so the float's provenance is pinned to the exact
 * source contract.
 *
 * Transitive soft-delete safety — NO new trigger needed. An active offering always references a
 * `deployed` fraction_contract (the service gates on it), and migration 028 already (a) forbids
 * soft-deleting a `deployed` contract (`CHK_fc_deployed_not_softdeleted`) and (b) blocks soft-deleting
 * an artwork that still has a live (`deploying|deployed`) contract (`trg_block_artwork_softdelete_with_live_fc`).
 * So neither the artwork nor the fraction_contract parent can be soft-deleted out from under a live
 * offering, and no `offerings`-specific soft-delete trigger is required. Hard-deletes of either parent
 * are refused by the inbound `ON DELETE RESTRICT` FKs below.
 *
 * `created_by_admin_sub` is a deliberate denormalization (todo 260): the actor is also recorded in the
 * `offering.planned` audit row, but keeping it on this long-lived money row supports a future admin
 * "offerings by planner" read without joining the append-only (separately-retained) audit log. It has NO
 * FK to `admins` by design — audit-actor semantics: retain the historical actor even if that admin is
 * later removed. It assumes the admin JWT `sub` is UUID-shaped (verified: `Admin.id` is a `uuid` PK).
 */
export class CreateOfferingsTable1716000000032 implements MigrationInterface {
  name = 'CreateOfferingsTable1716000000032';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "offerings" (
        "id"                    uuid          NOT NULL DEFAULT gen_random_uuid(),
        "artwork_id"            uuid          NOT NULL,
        "fraction_contract_id"  uuid          NOT NULL,
        "status"                varchar(16)   NOT NULL DEFAULT 'planned',
        "low_price_stroops"     numeric(39,0) NOT NULL,
        "high_price_stroops"    numeric(39,0) NOT NULL,
        "public_float"          numeric(39,0) NOT NULL,
        "window_open_at"        timestamptz   NOT NULL,
        "window_close_at"       timestamptz   NOT NULL,
        "created_by_admin_sub"  uuid          NOT NULL,
        "created_at"            timestamptz   NOT NULL DEFAULT now(),
        "updated_at"            timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"            timestamptz,
        CONSTRAINT "PK_offerings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_offerings_artwork" FOREIGN KEY ("artwork_id")
          REFERENCES "artworks" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_offerings_fraction_contract" FOREIGN KEY ("fraction_contract_id")
          REFERENCES "fraction_contracts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_off_status" CHECK ("status" IN ('planned','approved','opened','subscribed','settled','canceled')),
        CONSTRAINT "CHK_off_band" CHECK (
          "low_price_stroops" > 0 AND "high_price_stroops" > 0 AND
          "high_price_stroops" > "low_price_stroops" AND
          "high_price_stroops" <= 79228162514264337593543950335),
        CONSTRAINT "CHK_off_float" CHECK ("public_float" > 0 AND "public_float" <= 79228162514264337593543950335),
        CONSTRAINT "CHK_off_window" CHECK ("window_close_at" > "window_open_at")
      )
    `);

    // Authoritative "one active offering per artwork"; EXCLUDES terminal statuses (settled|canceled) and
    // soft-deleted rows, so a terminal or retired offering never blocks planning a fresh one.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_offerings_active_per_artwork"
        ON "offerings" ("artwork_id")
        WHERE "status" IN ('planned','approved','opened','subscribed') AND "deleted_at" IS NULL
    `);

    // NOTE (todo 264): no supporting index is created for the FK RESTRICT scans (fraction_contract_id, and
    // artwork_id in terminal/soft-deleted states) or for a by-artwork all-status read — deliberately deferred
    // (YAGNI). Both parents are effectively non-deletable at MVP scale (028's CHK/trigger + the composite FK),
    // and the only current lookup (active-offering-by-artwork) is served by the partial-unique index above.
    // The FR that first adds a parent-delete path or an offerings-by-artwork list must add the matching index.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Fail CLOSED: the CLI revert path (data-source.ts) does not run Joi validation, so NODE_ENV may be
    // unset — treat anything other than an explicit non-prod env as production (todo 261).
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        `Refusing to revert CreateOfferingsTable1716000000032 outside development/test (NODE_ENV=` +
          `${process.env.NODE_ENV ?? 'unset'}): "offerings" records money-adjacent primary-offering plans ` +
          '(price band, subscription window, public-float snapshot). Roll back the deployment instead.',
      );
    }
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_offerings_active_per_artwork"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "offerings"`);
  }
}
