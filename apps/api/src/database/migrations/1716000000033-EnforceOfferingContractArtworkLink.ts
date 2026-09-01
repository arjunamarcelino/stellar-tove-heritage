import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hard-enforce the offering↔contract↔artwork linkage (TOV-152, PR #36 review todo 259).
 *
 * `offerings` snapshots `public_float` from a specific `fraction_contracts` row and stores both
 * `artwork_id` and `fraction_contract_id`. The original two independent single-column FKs allowed an
 * offering on artwork A to reference a contract belonging to artwork B (only the service prevented it).
 * This migration replaces the single-column contract FK with a COMPOSITE FK on
 * `(artwork_id, fraction_contract_id)` → `fraction_contracts(artwork_id, id)`, so the database itself
 * guarantees the referenced contract belongs to the referenced artwork.
 *
 * Consequence: migration 032's "transitive soft-delete safety, no trigger needed" claim now genuinely
 * holds for an active offering — it references a `deployed`, same-artwork contract, which 028's
 * `CHK_fc_deployed_not_softdeleted` forbids soft-deleting and whose artwork 028's
 * `trg_block_artwork_softdelete_with_live_fc` forbids soft-deleting.
 */
export class EnforceOfferingContractArtworkLink1716000000033 implements MigrationInterface {
  name = 'EnforceOfferingContractArtworkLink1716000000033';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // FK target: a composite FK requires a UNIQUE on exactly the referenced columns. `id` is already the
    // PK (so this is trivially unique), but Postgres still needs the explicit (artwork_id, id) unique.
    await queryRunner.query(`
      ALTER TABLE "fraction_contracts"
        ADD CONSTRAINT "UQ_fc_artwork_id" UNIQUE ("artwork_id", "id")
    `);
    // Replace the single-column contract FK with the composite (artwork-matching) one.
    await queryRunner.query(`ALTER TABLE "offerings" DROP CONSTRAINT "FK_offerings_fraction_contract"`);
    await queryRunner.query(`
      ALTER TABLE "offerings"
        ADD CONSTRAINT "FK_offerings_artwork_fc"
        FOREIGN KEY ("artwork_id", "fraction_contract_id")
        REFERENCES "fraction_contracts" ("artwork_id", "id") ON DELETE RESTRICT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Fail CLOSED: the CLI revert path (data-source.ts) does not run Joi validation, so NODE_ENV may be
    // unset. Treat anything other than an explicit non-prod env as production for this money-adjacent table.
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        'Refusing to revert EnforceOfferingContractArtworkLink1716000000033 outside development/test ' +
          `(NODE_ENV=${process.env.NODE_ENV ?? 'unset'}): it weakens referential integrity on "offerings" ` +
          '(price band / window / public-float snapshots). Roll back the deployment instead.',
      );
    }
    await queryRunner.query(`ALTER TABLE "offerings" DROP CONSTRAINT "FK_offerings_artwork_fc"`);
    await queryRunner.query(`
      ALTER TABLE "offerings"
        ADD CONSTRAINT "FK_offerings_fraction_contract"
        FOREIGN KEY ("fraction_contract_id")
        REFERENCES "fraction_contracts" ("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`ALTER TABLE "fraction_contracts" DROP CONSTRAINT "UQ_fc_artwork_id"`);
  }
}
