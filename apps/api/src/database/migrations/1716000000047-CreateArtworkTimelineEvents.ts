import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TOV-191 (FR-08.02 + FR-08.03) — the public artwork provenance timeline table. Net-new, forward-only
 * (no backfill): events start accruing from deploy time. One append-ish row per timeline event.
 *
 * Confidentiality boundary: `visibility_tier` is a **GENERATED STORED** column derived from `event_type`
 * via a FAIL-CLOSED default-allowlist (`ELSE 'expanded'`) — a new/unclassified event_type hides in the
 * expand tier rather than leaking into the anonymous default stream. It can never be set/drifted by a writer.
 *
 * Two partial indexes (both predicated on `is_published` since every read requires it true):
 *   - IDX_ate_tier — `(artwork_id, visibility_tier, occurred_at DESC, id DESC)` serves the default-view
 *     keyset read (tier equality) AND the expanded COUNT as an index-only scan.
 *   - IDX_ate_all  — `(artwork_id, occurred_at DESC, id DESC)` serves the `?expand=true` cross-tier read.
 * `UQ_ate_source_ref` is a FULL unique index (NOT partial): a bare `ON CONFLICT (source_ref) DO NOTHING`
 * cannot infer a partial arbiter (42P10), and the best-effort emit would swallow that error → silent event
 * loss. Multiple NULL source_refs stay distinct in a standard unique index, so manual events are unaffected.
 *
 * The append-only guard blocks hard DELETE + soft-delete (forward-only provenance is never erased) and
 * permits the `admin_note` publish UPDATE (`is_published`, `summary`, `event_data`) while freezing
 * provenance + the idempotency key (`id`, `artwork_id`, `event_type`, `occurred_at`, `source_ref`,
 * `created_at`) — matching the secondary_trades / rfq_notifications convention. `occurred_at` is
 * `timestamptz(3)` (ms precision) so the keyset cursor round-trips losslessly through a JS `Date`.
 *
 * Plain `CREATE INDEX` (not CONCURRENTLY): the table is new/empty and invisible until this `each`-mode
 * migration transaction commits, so the ACCESS EXCLUSIVE lock has zero contention. `SET LOCAL lock_timeout`
 * bounds only the FK lock on `artworks`.
 */
export class CreateArtworkTimelineEvents1716000000047 implements MigrationInterface {
  name = 'CreateArtworkTimelineEvents1716000000047';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // SET LOCAL: auto-resets at COMMIT, so the ceiling can't leak onto a later migration on the shared conn.
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);

    await queryRunner.query(`
      CREATE TABLE "artwork_timeline_events" (
        "id"              uuid          NOT NULL DEFAULT gen_random_uuid(),
        "artwork_id"      uuid          NOT NULL,
        "event_type"      varchar(32)   NOT NULL,
        "visibility_tier" varchar(16)   NOT NULL
          GENERATED ALWAYS AS (
            CASE WHEN "event_type" IN (
                   'artwork_verification','fractionalization','exhibition','loan',
                   'condition_report','secondary_trade')
                 THEN 'default' ELSE 'expanded' END
          ) STORED,
        -- DEFAULT false (review #402): expanded-tier events are opt-in-published so a future admin_note/
        -- technical writer that omits the flag is NOT silently exposed to anonymous ?expand=true. The two
        -- current default-tier emitters set is_published=true explicitly, so no behavior change today.
        "is_published"    boolean       NOT NULL DEFAULT false,
        "occurred_at"     timestamptz(3) NOT NULL,
        "summary"         text,
        "event_data"      jsonb         NOT NULL DEFAULT '{}',
        "source_ref"      varchar(128),
        "created_at"      timestamptz   NOT NULL DEFAULT now(),
        "updated_at"      timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"      timestamptz,
        CONSTRAINT "PK_artwork_timeline_events" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_ate_event_type" CHECK ("event_type" IN (
          'artwork_verification','fractionalization','exhibition','loan','condition_report',
          'secondary_trade','admin_note','technical','attestation')),
        CONSTRAINT "FK_ate_artwork" FOREIGN KEY ("artwork_id")
          REFERENCES "artworks" ("id") ON DELETE RESTRICT
      )
    `);

    // Default-view keyset read (visibility_tier equality) + the expanded COUNT (index-only via the
    // (artwork_id, visibility_tier) equality prefix). is_published in the predicate: always-true, always matchable.
    await queryRunner.query(`
      CREATE INDEX "IDX_ate_tier" ON "artwork_timeline_events"
        ("artwork_id", "visibility_tier", "occurred_at" DESC, "id" DESC)
        WHERE "deleted_at" IS NULL AND "is_published"
    `);
    // expand=true cross-tier chronological read (a tier-keyed index would re-introduce a Sort here).
    await queryRunner.query(`
      CREATE INDEX "IDX_ate_all" ON "artwork_timeline_events"
        ("artwork_id", "occurred_at" DESC, "id" DESC)
        WHERE "deleted_at" IS NULL AND "is_published"
    `);
    // Idempotency belt — FULL unique so the bare ON CONFLICT (source_ref) is inferable (NULLs stay distinct).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ate_source_ref" ON "artwork_timeline_events" ("source_ref")
    `);

    // Append-only guard (TOV-191, review #400 — matches secondary_trades / rfq_notifications convention):
    // block hard DELETE and soft-delete (deleted_at) so forward-only provenance can never be silently erased,
    // and freeze provenance + the idempotency key on UPDATE. `is_published` / `summary` / `event_data` /
    // `updated_at` stay mutable (the admin_note publish flip). visibility_tier is generated (unassignable).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "fn_ate_guard"() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'artwork_timeline_events rows cannot be deleted' USING ERRCODE = 'raise_exception';
        END IF;
        IF NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at" THEN
          RAISE EXCEPTION 'artwork_timeline_events rows cannot be soft-deleted' USING ERRCODE = 'raise_exception';
        END IF;
        IF NEW."id" IS DISTINCT FROM OLD."id"
           OR NEW."artwork_id" IS DISTINCT FROM OLD."artwork_id"
           OR NEW."event_type" IS DISTINCT FROM OLD."event_type"
           OR NEW."occurred_at" IS DISTINCT FROM OLD."occurred_at"
           OR NEW."source_ref" IS DISTINCT FROM OLD."source_ref"
           OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
          RAISE EXCEPTION 'artwork_timeline_events immutable columns cannot change' USING ERRCODE = 'raise_exception';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_ate_guard"
        BEFORE UPDATE OR DELETE ON "artwork_timeline_events"
        FOR EACH ROW EXECUTE FUNCTION "fn_ate_guard"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Fail CLOSED outside dev/test: timeline events are forward-only provenance (no backfill), so a
    // DROP is real data loss. Roll back the deployment instead (redeploy previous commit).
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        `Refusing to revert CreateArtworkTimelineEvents1716000000047 outside development/test (NODE_ENV=` +
          `${process.env.NODE_ENV ?? 'unset'}): "artwork_timeline_events" is forward-only provenance with no ` +
          'backfill — a drop permanently loses timeline history. Roll back the deployment instead.',
      );
    }
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_ate_guard" ON "artwork_timeline_events"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "fn_ate_guard"()`);
    await queryRunner.query(`DROP TABLE IF EXISTS "artwork_timeline_events"`);
  }
}
