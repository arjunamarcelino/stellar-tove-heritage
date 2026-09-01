import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Evolve the user-level KYC status into the **whitelist lifecycle** (TOV-29, FR-01.08).
 *
 * `users.kyc_status` changes vocabulary from the 4-state review outcome
 * (`not_submitted`/`pending_review`/`approved`/`rejected`) to the 5-state whitelist lifecycle
 * (`not_submitted`/`pending_review`/`whitelisted`/`frozen`/`removed`). The per-submission
 * `kyc_submissions.status` enum is a DISTINCT axis and is left untouched. Two nullable columns are added
 * to carry the whitelist metadata the read endpoint surfaces: `whitelisted_at` and a `kyc_reason` CODE.
 *
 * ORDERING IS LOAD-BEARING: legacy `approved`/`rejected` rows are remapped BEFORE the new CHECK is
 * `VALIDATE`d, or VALIDATE would fail scanning a stale value. The current DB is expected to hold ZERO
 * such rows (only `not_submitted`/`pending_review` are ever written pre-M12), so the backfill is
 * defensive — but written for correctness if it ever fires.
 *
 * `whitelisted_at` is DELIBERATELY left NULL for migrated `approved→whitelisted` rows: `updated_at` is
 * the last write of ANY kind, NOT the approval time, and a wrong-but-plausible compliance timestamp is
 * worse than an honest null (the read DTO tolerates a whitelisted-with-null-timestamp row).
 *
 * All statements share TypeORM's per-migration transaction — do NOT set `transaction = false`, or a crash
 * mid-swap could leave `users.kyc_status` with no CHECK, silently accepting garbage.
 */
export class EvolveKycWhitelistStatus1716000000026 implements MigrationInterface {
  name = 'EvolveKycWhitelistStatus1716000000026';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fail fast if an ACCESS EXCLUSIVE acquisition queues behind long reads, rather than freezing all
    // `users` traffic behind the lock queue (LOCAL = scoped to this migration's transaction). Relies on the
    // transactional migration mode (`migration:run -t each`, the repo default + setup-test-db.sh) — under
    // `-t none` `SET LOCAL` is a silent no-op.
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);

    // Two nullable columns — fast catalog-only adds (PG11+, no table rewrite). Add BEFORE the backfill.
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "whitelisted_at" timestamptz`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "kyc_reason" varchar(256)`);

    // Drop the 4-value gate, remap legacy rows, then re-add + VALIDATE the 5-value gate (NOT VALID →
    // VALIDATE keeps the validate scan at SHARE UPDATE EXCLUSIVE, per house convention …025).
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_kyc_status"`);
    await queryRunner.query(`UPDATE "users" SET "kyc_status" = 'whitelisted' WHERE "kyc_status" = 'approved'`);
    await queryRunner.query(`UPDATE "users" SET "kyc_status" = 'not_submitted' WHERE "kyc_status" = 'rejected'`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_kyc_status" ` +
        `CHECK ("kyc_status" IN ('not_submitted','pending_review','whitelisted','frozen','removed')) NOT VALID`,
    );
    await queryRunner.query(`ALTER TABLE "users" VALIDATE CONSTRAINT "CHK_users_kyc_status"`);
    // NOTE: the existing column DEFAULT 'not_submitted' stays valid under the new CHECK — do not ALTER it.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Guarded (mirrors AddUsersHandle…023, NOT …025's absolute refusal): this revert is far less
    // destructive (two nullable columns + a lossy status remap). `frozen`/`removed` have no clean inverse
    // in the old 4-value enum, so they fold to `not_submitted` — acknowledged data loss.
    //
    // Like up(), the DROP→re-ADD constraint swap below shares this migration's revert transaction (TypeORM
    // wraps `undoLastMigration` in a transaction under the `-t each` mode) — never run under `-t none`, or a
    // crash between the DROP and the re-ADD leaves `users.kyc_status` unconstrained.
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DESTRUCTIVE_DOWN !== '1') {
      throw new Error(
        'Refusing to revert EvolveKycWhitelistStatus1716000000026 in production: frozen/removed collapse ' +
          'to not_submitted (lossy) and whitelist metadata is dropped. Set ALLOW_DESTRUCTIVE_DOWN=1 to proceed.',
      );
    }
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_kyc_status"`);
    // `whitelisted → approved` is the exact inverse of up()'s `approved → whitelisted` remap (so up→down→up
    // round-trips) — NOT a claim that the user was ever `approved` at the user level in real history (that
    // state was never written pre-M12). It only exists to satisfy the reverted 4-value CHECK.
    await queryRunner.query(`UPDATE "users" SET "kyc_status" = 'approved' WHERE "kyc_status" = 'whitelisted'`);
    await queryRunner.query(
      `UPDATE "users" SET "kyc_status" = 'not_submitted' WHERE "kyc_status" IN ('frozen','removed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_kyc_status" ` +
        `CHECK ("kyc_status" IN ('not_submitted','pending_review','approved','rejected')) NOT VALID`,
    );
    await queryRunner.query(`ALTER TABLE "users" VALIDATE CONSTRAINT "CHK_users_kyc_status"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "kyc_reason"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "whitelisted_at"`);
  }
}
