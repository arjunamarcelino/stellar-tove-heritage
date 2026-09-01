import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RFQ notification inbox + fan-out completion latch (TOV-174, FR-06.02).
 *
 * Creates `rfq_notifications` (one durable in-app row per (RFQ, holder)), adds the write-once
 * `rfqs.fanned_out_at` completion latch, and re-declares `fn_rfqs_guard` to enforce that latch write-once
 * while preserving every protection migration 041 installed.
 *
 * Two facts that shaped this migration (both from the deepening review):
 *  - The shipped `fn_rfqs_guard` is a FREEZE-LIST, so the latch UPDATE already succeeds under it. The
 *    `CREATE OR REPLACE` here adds ONLY the write-once invariant (NULL→timestamptz once) — it must re-emit
 *    the four existing protections verbatim, because `CREATE OR REPLACE` swaps the entire function body.
 *  - The idempotency belt `UQ_rfq_notifications_recipient_channel` is a FULL (non-partial) unique index, so
 *    the worker's `ON CONFLICT ("rfq_id","recipient_sub","channel") DO NOTHING` has an inferable arbiter
 *    (Postgres cannot infer a PARTIAL index from a bare conflict target → 42P10). Mirrors `UQ_rfqs_idem`.
 *
 * The backfill (`fanned_out_at = created_at` for pre-existing RFQs) prevents a deploy-time storm where the
 * reconcile sweep fans out historical RFQs. It MUST stay in the SAME transaction as `ADD COLUMN`: the ALTER's
 * ACCESS EXCLUSIVE lock closes the concurrent-insert window, so the backfill sees a frozen, fully-covered
 * row set. `created_at` (not `now()`) is the sentinel so `fanned_out_at − created_at` latency math stays
 * honest for backfilled rows. TRUNCATE (test teardown) doesn't fire row triggers.
 */
export class CreateRfqNotificationsTable1716000000042 implements MigrationInterface {
  name = 'CreateRfqNotificationsTable1716000000042';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // SET LOCAL (not a bare SET): the 3s ceiling auto-resets at COMMIT and can't leak onto a later migration
    // on TypeORM's shared migration:run connection (TOV-160 learning).
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);

    await queryRunner.query(`
      CREATE TABLE "rfq_notifications" (
        "id"            uuid        NOT NULL DEFAULT gen_random_uuid(),
        "rfq_id"        uuid        NOT NULL,
        "recipient_sub" uuid        NOT NULL,
        "artwork_id"    uuid        NOT NULL,
        "channel"       varchar(16) NOT NULL DEFAULT 'in_app',
        "read_at"       timestamptz,
        "created_at"    timestamptz NOT NULL DEFAULT now(),
        "updated_at"    timestamptz NOT NULL DEFAULT now(),
        "deleted_at"    timestamptz,
        CONSTRAINT "PK_rfq_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_notif_channel" CHECK ("channel" IN ('in_app')),
        -- FK to rfqs is safe: fn_rfqs_guard blocks RFQ delete/soft-delete, so a notification's parent never
        -- vanishes. No FK on recipient_sub/artwork_id (audit-actor semantics; a soft-deleted-winner still gets a row).
        CONSTRAINT "FK_rfq_notifications_rfq" FOREIGN KEY ("rfq_id")
          REFERENCES "rfqs" ("id") ON DELETE RESTRICT
      )
    `);

    // FULL unique dedup belt (NOT partial): the worker's bare ON CONFLICT target must be inferable, and the
    // guard freezes deleted_at NULL anyway so full ≡ partial behaviorally. Mirrors UQ_rfqs_idem.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_rfq_notifications_recipient_channel"
        ON "rfq_notifications" ("rfq_id", "recipient_sub", "channel")
    `);
    // Inbox page: owner-scoped, newest-first, stable id tiebreak (offset pagination + keyset-ready).
    await queryRunner.query(`
      CREATE INDEX "IDX_rfq_notifications_inbox"
        ON "rfq_notifications" ("recipient_sub", "created_at" DESC, "id" DESC)
        WHERE "deleted_at" IS NULL
    `);
    // Unread filter + bounded unread-count probe (id tiebreak for keyset over the unread set). The predicate
    // intentionally omits `deleted_at IS NULL`: it is safe ONLY because fn_rfq_notifications_guard blocks
    // soft-delete, so `deleted_at` is always NULL on this table (todo 368).
    await queryRunner.query(`
      CREATE INDEX "IDX_rfq_notifications_unread"
        ON "rfq_notifications" ("recipient_sub", "created_at" DESC, "id" DESC)
        WHERE "read_at" IS NULL
    `);

    // Minimal immutability guard: durable inbox, so block delete/soft-delete + freeze the identity columns.
    // read_at is intentionally NOT frozen (a future mark-unread needs no guard migration); no status machine
    // (the delivery-status column was dropped — channel is the single email seam).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "fn_rfq_notifications_guard"() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'rfq_notifications rows cannot be deleted' USING ERRCODE = 'raise_exception';
        END IF;
        IF NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at" THEN
          RAISE EXCEPTION 'rfq_notifications rows cannot be soft-deleted' USING ERRCODE = 'raise_exception';
        END IF;
        IF NEW."id" <> OLD."id" OR NEW."rfq_id" <> OLD."rfq_id"
           OR NEW."recipient_sub" <> OLD."recipient_sub" OR NEW."artwork_id" <> OLD."artwork_id"
           OR NEW."channel" <> OLD."channel" OR NEW."created_at" <> OLD."created_at" THEN
          RAISE EXCEPTION 'rfq_notifications immutable columns cannot change' USING ERRCODE = 'raise_exception';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_rfq_notifications_guard"
        BEFORE UPDATE OR DELETE ON "rfq_notifications"
        FOR EACH ROW EXECUTE FUNCTION "fn_rfq_notifications_guard"()
    `);

    // ── rfqs.fanned_out_at completion latch ────────────────────────────────────────────────────────────
    // ADD COLUMN → backfill → re-declare guard → reconcile index, ALL in this one transaction. Do NOT split
    // ADD COLUMN and the backfill into separate migrations: the shared ACCESS EXCLUSIVE lock is what closes
    // the concurrent-insert window so the backfill covers 100% of pre-existing rows.
    await queryRunner.query(`ALTER TABLE "rfqs" ADD COLUMN "fanned_out_at" timestamptz`);
    await queryRunner.query(
      `UPDATE "rfqs" SET "fanned_out_at" = "created_at" WHERE "fanned_out_at" IS NULL`,
    );

    // Re-declare fn_rfqs_guard: re-emit the FOUR shipped protections VERBATIM (041) + a NULL-safe write-once
    // branch for fanned_out_at. Do NOT add fanned_out_at to the <> immutable-columns chain — it is nullable
    // and `NULL <> x` is NULL (would not enforce). A status-only transition leaves fanned_out_at unchanged,
    // so the write-once branch (OLD IS NULL, or NEW = OLD) does not falsely reject it.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "fn_rfqs_guard"() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'rfqs rows cannot be deleted' USING ERRCODE = 'raise_exception';
        END IF;
        IF NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at" THEN
          RAISE EXCEPTION 'rfqs rows cannot be soft-deleted' USING ERRCODE = 'raise_exception';
        END IF;
        IF NEW."id" <> OLD."id" OR NEW."collector_sub" <> OLD."collector_sub"
           OR NEW."artwork_id" <> OLD."artwork_id" OR NEW."fraction_contract_id" <> OLD."fraction_contract_id"
           OR NEW."fraction_count" <> OLD."fraction_count"
           OR NEW."max_price_per_fraction_stroops" <> OLD."max_price_per_fraction_stroops"
           OR NEW."idempotency_key_hash" <> OLD."idempotency_key_hash"
           OR NEW."expires_at" <> OLD."expires_at" OR NEW."created_at" <> OLD."created_at" THEN
          RAISE EXCEPTION 'rfqs immutable columns cannot change' USING ERRCODE = 'raise_exception';
        END IF;
        -- TOV-174: fanned_out_at is write-once (NULL → timestamptz once; frozen thereafter, incl. ts → NULL).
        IF OLD."fanned_out_at" IS NOT NULL
           AND NEW."fanned_out_at" IS DISTINCT FROM OLD."fanned_out_at" THEN
          RAISE EXCEPTION 'rfqs.fanned_out_at is write-once' USING ERRCODE = 'raise_exception';
        END IF;
        -- forward-only status machine: open → filled|canceled|expired (no backward, no terminal→terminal).
        IF OLD."status" <> NEW."status"
           AND NOT (OLD."status" = 'open' AND NEW."status" IN ('filled','canceled','expired')) THEN
          RAISE EXCEPTION 'rfqs illegal status transition % -> %', OLD."status", NEW."status"
            USING ERRCODE = 'raise_exception';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    // Reconcile scan index: only un-latched rows (near-empty post-backfill; every fan-out removes its row).
    await queryRunner.query(`
      CREATE INDEX "IDX_rfqs_unfanned" ON "rfqs" ("created_at")
        WHERE "fanned_out_at" IS NULL AND "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Fail CLOSED (mirror 041): the CLI revert path does not run Joi validation, so treat anything other than
    // an explicit non-prod env as production. rfq_notifications is an append-only inbox trail.
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        `Refusing to revert CreateRfqNotificationsTable1716000000042 outside development/test (NODE_ENV=` +
          `${process.env.NODE_ENV ?? 'unset'}): "rfq_notifications" is an append-only inbox trail and the ` +
          'rfqs guard change must not be hand-reverted in prod. Roll back the deployment instead.',
      );
    }
    // Drop the child (FK) + notification guard first.
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_rfq_notifications_guard" ON "rfq_notifications"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "fn_rfq_notifications_guard"()`);
    await queryRunner.query(`DROP TABLE IF EXISTS "rfq_notifications"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_rfqs_unfanned"`);
    // Restore the EXACT 041 fn_rfqs_guard body (no fanned_out_at reference) BEFORE dropping the column, so the
    // installed function never references a dropped column (which would error on every subsequent rfqs UPDATE).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "fn_rfqs_guard"() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'rfqs rows cannot be deleted' USING ERRCODE = 'raise_exception';
        END IF;
        IF NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at" THEN
          RAISE EXCEPTION 'rfqs rows cannot be soft-deleted' USING ERRCODE = 'raise_exception';
        END IF;
        IF NEW."id" <> OLD."id" OR NEW."collector_sub" <> OLD."collector_sub"
           OR NEW."artwork_id" <> OLD."artwork_id" OR NEW."fraction_contract_id" <> OLD."fraction_contract_id"
           OR NEW."fraction_count" <> OLD."fraction_count"
           OR NEW."max_price_per_fraction_stroops" <> OLD."max_price_per_fraction_stroops"
           OR NEW."idempotency_key_hash" <> OLD."idempotency_key_hash"
           OR NEW."expires_at" <> OLD."expires_at" OR NEW."created_at" <> OLD."created_at" THEN
          RAISE EXCEPTION 'rfqs immutable columns cannot change' USING ERRCODE = 'raise_exception';
        END IF;
        IF OLD."status" <> NEW."status"
           AND NOT (OLD."status" = 'open' AND NEW."status" IN ('filled','canceled','expired')) THEN
          RAISE EXCEPTION 'rfqs illegal status transition % -> %', OLD."status", NEW."status"
            USING ERRCODE = 'raise_exception';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    // Never DROP TABLE rfqs — it is owned by migration 041.
    await queryRunner.query(`ALTER TABLE "rfqs" DROP COLUMN IF EXISTS "fanned_out_at"`);
  }
}
