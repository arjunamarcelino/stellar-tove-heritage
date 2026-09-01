import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widen the KYC-allowlist wallet CHECKs from contract-only (`C…`) to account-or-contract (`G…` or `C…`)
 * (TOV-243, blocks TOV-33). On-chain `KycAllowlist.add`/`is_allowed` already accept any `Address`; the C-only
 * regex was purely a backend guardrail. This lets a Collector's BYOW classic settlement wallet (a `G…`
 * account) be allowlisted so `FractionToken.transfer` to it no longer reverts `RecipientNotWhitelisted`.
 *
 * The new regex `^[GC][A-Z2-7]{55}$` is a strict SUPERSET of 029's `^C[A-Z2-7]{55}$`, so every existing
 * (all-C) row already satisfies it — `ADD … NOT VALID` + `VALIDATE` can never fail. A CHECK never rewrites
 * the table. NB: because `migrationsTransactionMode: 'each'` wraps up() in ONE transaction, the ACCESS
 * EXCLUSIVE taken by the preceding `DROP CONSTRAINT` is held until COMMIT — so readers/writers are blocked
 * for the whole (sub-ms) transaction, not merely the catalog flip; the split into `NOT VALID` + `VALIDATE`
 * (lighter SHARE UPDATE EXCLUSIVE scan) does not buy online-ness here. It's safe only because these tables
 * are tiny advisory/audit mirrors and `lock_timeout='3s'` fails fast rather than queueing. The immutability
 * trigger on `kyc_allowlist_events` fires on row UPDATE/DELETE only, NOT on this DDL / read-only validation
 * scan. `G…` and `C…` are both exactly 56 chars, so the `char(56)` columns need no change.
 *
 * down() FOOTGUN (documented, intentional): re-narrowing to `^C…` re-adds a VALIDATED (not `NOT VALID`)
 * constraint, so it ABORTS the revert with SQLSTATE 23514 if any `G…` row exists — and `kyc_allowlist_events`
 * is append-only + immutable-triggered, so such a row cannot be deleted to clean it. Production is refused
 * outright (mirrors 029/037). This revert is only meaningful before any G-address has ever been allowlisted;
 * once one has, roll back the deployment instead.
 */
export class WidenKycAllowlistWalletCheckToGC1716000000057 implements MigrationInterface {
  name = 'WidenKycAllowlistWalletCheckToGC1716000000057';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);

    // No IF EXISTS on the DROP: 029 guarantees the constraint exists and migrations run once, in order.
    await queryRunner.query(`ALTER TABLE "kyc_allowlist_events" DROP CONSTRAINT "CHK_kae_wallet"`);
    await queryRunner.query(
      `ALTER TABLE "kyc_allowlist_events" ADD CONSTRAINT "CHK_kae_wallet" ` +
        `CHECK ("wallet" ~ '^[GC][A-Z2-7]{55}$') NOT VALID`,
    );
    await queryRunner.query(`ALTER TABLE "kyc_allowlist_events" VALIDATE CONSTRAINT "CHK_kae_wallet"`);

    await queryRunner.query(`ALTER TABLE "kyc_allowlist_state" DROP CONSTRAINT "CHK_kas_wallet"`);
    await queryRunner.query(
      `ALTER TABLE "kyc_allowlist_state" ADD CONSTRAINT "CHK_kas_wallet" ` +
        `CHECK ("wallet" ~ '^[GC][A-Z2-7]{55}$') NOT VALID`,
    );
    await queryRunner.query(`ALTER TABLE "kyc_allowlist_state" VALIDATE CONSTRAINT "CHK_kas_wallet"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Fail CLOSED (see 037): the CLI revert path skips Joi validation, so NODE_ENV may be unset — treat
    // anything other than an explicit non-prod env as production.
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        `Refusing to revert WidenKycAllowlistWalletCheckToGC1716000000057 outside development/test (NODE_ENV=` +
          `${process.env.NODE_ENV ?? 'unset'}): re-narrowing to contract-only (C…) breaks any allowlisted ` +
          'BYOW G-address and cannot pass validation once a G-row exists. Roll back the deployment instead.',
      );
    }
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);

    // Re-add VALIDATED (NOT `NOT VALID`) so a stray G-row ABORTS the revert (23514) instead of leaving a
    // catalog lie. `kyc_allowlist_events` is append-only/immutable, so a G-row there cannot be cleaned.
    await queryRunner.query(`ALTER TABLE "kyc_allowlist_events" DROP CONSTRAINT "CHK_kae_wallet"`);
    await queryRunner.query(
      `ALTER TABLE "kyc_allowlist_events" ADD CONSTRAINT "CHK_kae_wallet" CHECK ("wallet" ~ '^C[A-Z2-7]{55}$')`,
    );

    await queryRunner.query(`ALTER TABLE "kyc_allowlist_state" DROP CONSTRAINT "CHK_kas_wallet"`);
    await queryRunner.query(
      `ALTER TABLE "kyc_allowlist_state" ADD CONSTRAINT "CHK_kas_wallet" CHECK ("wallet" ~ '^C[A-Z2-7]{55}$')`,
    );
  }
}
