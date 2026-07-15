import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * internal_audit_log (TOV-40; forward-compatible with the TOV-124 audit-export pipeline). Append-only:
 * no `updated_at` / `deleted_at`. Append-only should also be enforced at the grant level in each
 * environment (`REVOKE UPDATE, DELETE ON internal_audit_log FROM <app_role>`) — not done here because
 * the app role name is environment-specific; tracked as an ops step.
 */
export class AddInternalAuditLog1716000000015 implements MigrationInterface {
  name = 'AddInternalAuditLog1716000000015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "internal_audit_log" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "actor_type" varchar(16) NOT NULL,
        "actor_id" uuid,
        "kind" varchar(64) NOT NULL,
        "subject_type" varchar(32) NOT NULL,
        "subject_id" uuid NOT NULL,
        "payload" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_internal_audit_log" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_internal_audit_log_actor_type" CHECK ("actor_type" IN ('user', 'system'))
      )
    `);
    // "all events of a kind in a time window" (the common analytics query).
    await queryRunner.query(`
      CREATE INDEX "IDX_internal_audit_log_kind_created_at"
        ON "internal_audit_log" ("kind", "created_at")
    `);
    // "everything about a subject" (e.g. one export's lifecycle).
    await queryRunner.query(`
      CREATE INDEX "IDX_internal_audit_log_subject"
        ON "internal_audit_log" ("subject_type", "subject_id")
    `);
    // Pure time-range scans (the TOV-124 date-ranged export). BRIN is tiny + ideal for an append-only,
    // insert-ordered time series.
    await queryRunner.query(`
      CREATE INDEX "BRIN_internal_audit_log_created_at"
        ON "internal_audit_log" USING brin ("created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "BRIN_internal_audit_log_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_internal_audit_log_subject"`);
    await queryRunner.query(`DROP INDEX "IDX_internal_audit_log_kind_created_at"`);
    await queryRunner.query(`DROP TABLE "internal_audit_log"`);
  }
}
