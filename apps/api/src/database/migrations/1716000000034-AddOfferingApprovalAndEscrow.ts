import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Multi-sig approval + escrow-deploy for primary Offerings (TOV-154, FR-05.02). Extends the `offerings`
 * money row (migration 032) with escrow-deploy provenance (`escrow_deploy_status`,
 * `escrow_contract_address`) plus a money-routing attestation snapshot (`snapshot_artist_address`,
 * Enhancement #1 / security BLOCKER-1 — the payout address the approvers attest to, frozen at first
 * approval; WS7 re-asserts fraction_contracts still matches before deploy). All three columns are NULLABLE
 * because existing `planned` rows predate approval, so every added CHECK validates vacuously — no backfill.
 *
 * `offering_approvals` is the append-only quorum ledger: one live signature per (offering, admin). A
 * selective `BEFORE UPDATE OR DELETE` trigger (`fn_offering_approvals_append_only`) blocks DELETE, freezes
 * the immutable columns, and makes soft-delete one-way (NULL → timestamp only). TRUNCATE (test teardown)
 * does not fire row triggers, so `truncateTables` still works.
 *
 * The one-active-per-artwork index (`UQ_offerings_active_per_artwork`, migration 032) is unaffected:
 * both `planned` and `approved` are in `ACTIVE_OFFERING_STATUSES`, so it holds across the transition.
 *
 * DEPLOYMENT PRECONDITION (todo 292): `CHK_off_approved_has_escrow` is added as an IMMEDIATELY-validated
 * constraint. That is safe only because every existing `offerings` row is `planned` with a NULL
 * `escrow_contract_address` (TOV-152 has no transition out of `planned` yet), so the CHECK validates
 * vacuously. If a prod dataset ever already held an `approved|opened|subscribed|settled` row with a NULL
 * escrow address, the `ADD CONSTRAINT` would hard-fail — in that case split into `ADD CONSTRAINT ... NOT
 * VALID` + a later `VALIDATE CONSTRAINT`. Verified against current data reality before shipping.
 */
export class AddOfferingApprovalAndEscrow1716000000034 implements MigrationInterface {
  name = 'AddOfferingApprovalAndEscrow1716000000034';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fail fast rather than stall behind a long lock on the money-adjacent "offerings" table.
    await queryRunner.query(`SET lock_timeout = '3s'`);

    // Nullable: existing planned rows predate approval. Provenance columns escrow_deploy_ledger/
    // escrow_deploy_tx_hash/approved_at were CUT per Enhancement #8 — that data lives in the audit payload.
    await queryRunner.query(`
      ALTER TABLE "offerings"
        ADD COLUMN "escrow_deploy_status"     varchar(16),
        ADD COLUMN "escrow_contract_address"  char(56),
        ADD COLUMN "snapshot_artist_address"  char(56)
    `);

    await queryRunner.query(`
      ALTER TABLE "offerings"
        ADD CONSTRAINT "CHK_off_escrow_deploy_status"
          CHECK ("escrow_deploy_status" IS NULL OR "escrow_deploy_status" IN ('deploying','deployed','failed')),
        ADD CONSTRAINT "CHK_off_escrow_addr"
          CHECK ("escrow_contract_address" IS NULL OR "escrow_contract_address" ~ '^C[A-Z2-7]{55}$'),
        ADD CONSTRAINT "CHK_off_snapshot_artist_addr"
          CHECK ("snapshot_artist_address" IS NULL OR "snapshot_artist_address" ~ '^[GC][A-Z2-7]{55}$'),
        ADD CONSTRAINT "CHK_off_approved_has_escrow"
          CHECK ("status" NOT IN ('approved','opened','subscribed','settled') OR "escrow_contract_address" IS NOT NULL)
    `);

    await queryRunner.query(`
      CREATE TABLE "offering_approvals" (
        "id"          uuid        NOT NULL DEFAULT gen_random_uuid(),
        "offering_id" uuid        NOT NULL,
        "admin_sub"   uuid        NOT NULL,
        "created_at"  timestamptz NOT NULL DEFAULT now(),
        "updated_at"  timestamptz NOT NULL DEFAULT now(),
        "deleted_at"  timestamptz,
        CONSTRAINT "PK_offering_approvals" PRIMARY KEY ("id"),
        CONSTRAINT "FK_offering_approvals_offering" FOREIGN KEY ("offering_id")
          REFERENCES "offerings" ("id") ON DELETE RESTRICT
      )
    `);

    // One live signature per (offering, admin): the double-count guard AND the quorum-count read path.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_offering_approvals_signer"
        ON "offering_approvals" ("offering_id", "admin_sub")
        WHERE "deleted_at" IS NULL
    `);
    // Expiry-scan support (Enhancement #11). The composite unique above already covers offering-scoped
    // reads, so the old IDX_offering_approvals_offering was DROPPED as redundant (performance M2).
    await queryRunner.query(`
      CREATE INDEX "IDX_offering_approvals_expiry"
        ON "offering_approvals" ("created_at")
        WHERE "deleted_at" IS NULL
    `);

    // Append-only, but SELECTIVE (data-integrity H3): DELETE blocked, immutable columns frozen, and
    // soft-delete is final and one-way (only NULL -> timestamp allowed; no un-expire, no re-timestamp).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "fn_offering_approvals_append_only"() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'offering_approvals is append-only (DELETE not allowed)' USING ERRCODE = 'raise_exception';
        END IF;
        -- immutable columns can never change (checked regardless of a concurrent deleted_at set)
        IF NEW."id" <> OLD."id" OR NEW."offering_id" <> OLD."offering_id"
           OR NEW."admin_sub" <> OLD."admin_sub" OR NEW."created_at" <> OLD."created_at" THEN
          RAISE EXCEPTION 'offering_approvals immutable columns cannot change' USING ERRCODE = 'raise_exception';
        END IF;
        -- soft-delete is final and one-way: only NULL -> timestamp is allowed (no un-expire, no re-timestamp)
        IF OLD."deleted_at" IS NOT NULL THEN
          RAISE EXCEPTION 'offering_approvals soft-delete is final' USING ERRCODE = 'raise_exception';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_offering_approvals_append_only"
        BEFORE UPDATE OR DELETE ON "offering_approvals"
        FOR EACH ROW EXECUTE FUNCTION "fn_offering_approvals_append_only"()
    `);

    // Reconcile window-open sweep (only sweep remaining after Enhancement #7): 'approved' rows due to open.
    await queryRunner.query(`
      CREATE INDEX "IDX_off_approved_open_due"
        ON "offerings" ("window_open_at")
        WHERE "status" = 'approved' AND "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Fail CLOSED: the CLI revert path (data-source.ts) does not run Joi validation, so NODE_ENV may be
    // unset — treat anything other than an explicit non-prod env as production (todo 261).
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        `Refusing to revert AddOfferingApprovalAndEscrow1716000000034 outside development/test (NODE_ENV=` +
          `${process.env.NODE_ENV ?? 'unset'}): "offering_approvals" records irreversible multi-sig approval ` +
          'signatures and "offerings" carries on-chain escrow-deploy provenance. Roll back the deployment instead.',
      );
    }
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_off_approved_open_due"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_offering_approvals_append_only" ON "offering_approvals"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "fn_offering_approvals_append_only"()`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_offering_approvals_expiry"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_offering_approvals_signer"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "offering_approvals"`);
    await queryRunner.query(`ALTER TABLE "offerings" DROP CONSTRAINT IF EXISTS "CHK_off_approved_has_escrow"`);
    await queryRunner.query(`ALTER TABLE "offerings" DROP CONSTRAINT IF EXISTS "CHK_off_snapshot_artist_addr"`);
    await queryRunner.query(`ALTER TABLE "offerings" DROP CONSTRAINT IF EXISTS "CHK_off_escrow_addr"`);
    await queryRunner.query(`ALTER TABLE "offerings" DROP CONSTRAINT IF EXISTS "CHK_off_escrow_deploy_status"`);
    await queryRunner.query(`ALTER TABLE "offerings" DROP COLUMN IF EXISTS "snapshot_artist_address"`);
    await queryRunner.query(`ALTER TABLE "offerings" DROP COLUMN IF EXISTS "escrow_contract_address"`);
    await queryRunner.query(`ALTER TABLE "offerings" DROP COLUMN IF EXISTS "escrow_deploy_status"`);
  }
}
