import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Partial covering index for the holdings read (TOV-237). `GET /v1/me/holdings` runs
 * `findAllDeployed()` = `SELECT ... FROM fraction_contracts WHERE status='deployed' AND deleted_at IS NULL`
 * on every cache miss. The existing indexes don't cover it: `UQ_fraction_contracts_active_per_artwork`
 * is keyed on `artwork_id` (no status selectivity) and `IDX_fc_deploying_created_at` is `status='deploying'`
 * only — so the query falls back to a seq-scan that grows with the catalog. This partial index matches the
 * predicate exactly and keys on the two columns `buildHoldings` consumes (`artwork_id`, `token_address`),
 * enabling an index-only scan.
 *
 * House convention (…026/…030): bound the exclusive-lock acquisition with `lock_timeout`. `CREATE INDEX`
 * (non-CONCURRENTLY, since migrations run in a transaction) takes a brief ACCESS EXCLUSIVE lock —
 * instantaneous on the near-empty table. If `fraction_contracts` ever grows large before deploy, build it
 * out-of-band with `CONCURRENTLY` instead.
 */
export class AddFractionContractsDeployedIndex1716000000031 implements MigrationInterface {
  name = 'AddFractionContractsDeployedIndex1716000000031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(`
      CREATE INDEX "IDX_fc_deployed"
        ON "fraction_contracts" ("artwork_id", "token_address")
        WHERE "status" = 'deployed' AND "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_fc_deployed"`);
  }
}
