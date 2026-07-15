import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Collector handle history + public read (TOV-27, FR-01.06). Three parts:
 *
 *  (1) `users.handle_history_public` — per-collector opt-out (default TRUE = the AC's public trail). When
 *      FALSE the public `GET /collectors/:handle` returns `previous_handles: []`. `NOT NULL DEFAULT true` is
 *      a fast catalog-only add (PG11+ stores the default in the catalog — no table rewrite).
 *
 *  (2) `handle_history` — append-only ledger, one row per handle a collector has HELD. `handle` is the
 *      display casing; `handle_canonical` is DB-generated `lower(handle)` (mirrors users.handle_canonical,
 *      no rewrite since the table is created empty). `HandleService.setHandle` appends the NEW handle on
 *      every real change; the public read excludes the current canonical and dedups the rest.
 *
 *  (3) UPDATE-immutability trigger — a BEFORE UPDATE trigger that RAISEs, mirroring internal_audit_log
 *      (…015/…017) but scoped to UPDATE ONLY (unlike …017's UPDATE OR DELETE) so the FK `ON DELETE CASCADE`
 *      — the sole handle-history purge path today, and the hook for a future privileged GDPR admin-erase —
 *      still fires. This makes rows un-EDITABLE, NOT un-DELETABLE: an ad-hoc `DELETE FROM handle_history`
 *      by the app role is still permitted (a weaker guarantee than internal_audit_log). If tamper-evident
 *      deletion is required later, `REVOKE DELETE ON handle_history FROM <app_role>` (CASCADE deletes run
 *      as the parent op and bypass the child DELETE privilege, so erasure keeps working).
 *      NOTE: TRUNCATE fires BEFORE TRUNCATE triggers only, so test teardown that TRUNCATEs is unaffected.
 *
 * Backfill (4) seeds one row (current handle) for every existing live handle-holder — without it a TOV-26
 * collector who claimed a handle before this table existed would LOSE it on their first post-deploy change
 * (setHandle appends only the new handle). `WHERE NOT EXISTS` makes the backfill idempotent; the uniform
 * `now()` is the honest "known since deploy" timestamp (never users.updated_at, which any edit bumps).
 *
 * This is NOT a soft-delete table (append-only, UPDATE-blocked), so the "partial index on deleted_at" rule
 * does not apply. If `users` ever holds >100k handle-bearing rows at deploy, convert the backfill to a
 * batched/post-deploy job to bound the migration transaction + WAL size.
 */
export class CreateHandleHistory1716000000024 implements MigrationInterface {
  name = 'CreateHandleHistory1716000000024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // (1) privacy opt-out flag — fast catalog-only add (no rewrite).
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "handle_history_public" boolean NOT NULL DEFAULT true`,
    );

    // (2) append-only ledger.
    await queryRunner.query(`
      CREATE TABLE "handle_history" (
        "id"               uuid        NOT NULL DEFAULT gen_random_uuid(),
        "user_id"          uuid        NOT NULL,
        "handle"           varchar(24) NOT NULL,
        "handle_canonical" text        GENERATED ALWAYS AS (lower("handle")) STORED,
        "created_at"       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_handle_history" PRIMARY KEY ("id"),
        CONSTRAINT "FK_handle_history_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    // Serves both the per-user newest-first read AND the FK lookups (its user_id prefix); a separate
    // single-column user_id index would be redundant.
    await queryRunner.query(`
      CREATE INDEX "IDX_handle_history_user_created"
        ON "handle_history" ("user_id", "created_at" DESC)
    `);

    // (3) UPDATE-immutability enforcement — UPDATE-only so ON DELETE CASCADE erasure still works. Rows are
    // un-editable but not un-deletable; see the header note (REVOKE DELETE) if tamper-evident deletion is needed.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "handle_history_no_update"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'handle_history is append-only (% not allowed)', TG_OP;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_handle_history_no_update"
        BEFORE UPDATE ON "handle_history"
        FOR EACH ROW EXECUTE FUNCTION "handle_history_no_update"()
    `);

    // (4) idempotent backfill of existing live handle-holders.
    await queryRunner.query(`
      INSERT INTO "handle_history" ("user_id", "handle", "created_at")
        SELECT u."id", u."handle", now()
        FROM "users" u
        WHERE u."handle" IS NOT NULL
          AND u."deleted_at" IS NULL
          AND NOT EXISTS (SELECT 1 FROM "handle_history" h WHERE h."user_id" = u."id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ⚠️ DATA LOSS: handle history is collector-chosen and NOT re-derivable. Fail-closed in prod unless
    // explicitly opted in — mirrors AddUsersHandle1716000000023. Drop in dependency order.
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DESTRUCTIVE_DOWN !== '1') {
      throw new Error(
        'Refusing to revert CreateHandleHistory1716000000024 in production: dropping "handle_history" ' +
          'discards collector handle history. Export it, then set ALLOW_DESTRUCTIVE_DOWN=1 to proceed.',
      );
    }
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_handle_history_no_update" ON "handle_history"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "handle_history_no_update"()`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_handle_history_user_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "handle_history"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "handle_history_public"`);
  }
}
