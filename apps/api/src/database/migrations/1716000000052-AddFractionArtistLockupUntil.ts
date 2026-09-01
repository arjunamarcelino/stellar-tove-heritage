import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TOV-33 (FR-01.12) — persist the deploy-time-anchored artist lockup expiry so the wallet-rotation gate has
 * a WRITE-SAFE anchor. The fraction-deploy worker already computes `artist_lockup_until` (the exact u64 baked
 * on-chain, `computeLockupUntil(deployTs, artist_lockup_days)`) but discards it; going forward it persists it
 * via the `casDeployed` path. This column is the source the rotation lockup gate reads (`now < until`) — NOT
 * the fail-open, request-time-anchored `me-holdings` display calc.
 *
 * Additive nullable `ADD COLUMN` (metadata-only, no table rewrite). Backfill existing `deployed` rows
 * best-effort from `created_at + artist_lockup_days` — this is the REQUEST-time anchor (precedes the on-chain
 * deploy close-time), so a legacy row may false-ALLOW at the gate; the on-chain FractionToken hard-refuses any
 * genuinely-locked transfer as the backstop (a mistaken allow fails at submit re-simulation, not a clean 422).
 * New deploys carry the exact on-chain value. Epoch SECONDS (~10 digits), never a raw u64 count.
 *
 * `fraction_contracts` is small (one row per fractionalization), so a single in-txn backfill UPDATE is fine.
 */
export class AddFractionArtistLockupUntil1716000000052 implements MigrationInterface {
  name = 'AddFractionArtistLockupUntil1716000000052';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);

    await queryRunner.query(`
      ALTER TABLE "fraction_contracts" ADD COLUMN "artist_lockup_until" bigint
    `);

    // Best-effort backfill of deployed rows (request-time anchor; chain is the hard backstop).
    await queryRunner.query(`
      UPDATE "fraction_contracts"
         SET "artist_lockup_until" = EXTRACT(EPOCH FROM "created_at")::bigint + "artist_lockup_days" * 86400
       WHERE "status" = 'deployed' AND "artist_lockup_until" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        `Refusing to revert AddFractionArtistLockupUntil1716000000052 outside development/test (NODE_ENV=` +
          `${process.env.NODE_ENV ?? 'unset'}): it drops the deploy-time lockup anchor. Roll back the ` +
          'deployment instead.',
      );
    }
    await queryRunner.query(`ALTER TABLE "fraction_contracts" DROP COLUMN IF EXISTS "artist_lockup_until"`);
  }
}
