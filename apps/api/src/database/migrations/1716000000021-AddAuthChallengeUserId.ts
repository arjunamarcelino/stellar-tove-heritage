import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * User-bound SEP-10 challenges (TOV-24 security hardening). Adding a wallet to an already-authenticated
 * Collector issues a challenge stamped with `user_id`; verify asserts `user_id` matches the caller, so a
 * leaked/misdirected signed challenge XDR cannot be replayed into a different account (first-claim hijack).
 *
 * Nullable: anonymous LOGIN challenges (`auth/sep10/verify`) keep `user_id = NULL`; the bind flow requires
 * a non-null match. `ON DELETE CASCADE` so a user delete cleans up their ephemeral challenge rows.
 */
export class AddAuthChallengeUserId1716000000021 implements MigrationInterface {
  name = 'AddAuthChallengeUserId1716000000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth_challenges" ADD COLUMN "user_id" uuid`);
    await queryRunner.query(`
      ALTER TABLE "auth_challenges" ADD CONSTRAINT "FK_auth_challenges_user_id"
        FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_auth_challenges_user_id" ON "auth_challenges" ("user_id") WHERE "user_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_auth_challenges_user_id"`);
    await queryRunner.query(
      `ALTER TABLE "auth_challenges" DROP CONSTRAINT IF EXISTS "FK_auth_challenges_user_id"`,
    );
    await queryRunner.query(`ALTER TABLE "auth_challenges" DROP COLUMN IF EXISTS "user_id"`);
  }
}
