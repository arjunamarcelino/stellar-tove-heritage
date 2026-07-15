import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enforce internal_audit_log append-only at the DB layer (TOV-40, review todo 125->126). A
 * BEFORE UPDATE OR DELETE trigger that RAISEs is role-agnostic — unlike a REVOKE it does not depend on
 * the environment-specific app role name, and a compliance ledger must be immutable in fact, not just by
 * convention. NOTE: TRUNCATE fires BEFORE TRUNCATE triggers only (not row DELETE triggers), so test
 * teardown that TRUNCATEs the table is unaffected.
 */
export class EnforceAuditLogAppendOnly1716000000017 implements MigrationInterface {
  name = 'EnforceAuditLogAppendOnly1716000000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "internal_audit_log_immutable"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'internal_audit_log is append-only (% not allowed)', TG_OP;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_internal_audit_log_immutable"
        BEFORE UPDATE OR DELETE ON "internal_audit_log"
        FOR EACH ROW EXECUTE FUNCTION "internal_audit_log_immutable"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_internal_audit_log_immutable" ON "internal_audit_log"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "internal_audit_log_immutable"()`);
  }
}
