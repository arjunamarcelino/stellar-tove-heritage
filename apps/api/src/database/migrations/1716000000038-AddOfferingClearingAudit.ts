import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Uniform-price clearing + settlement for primary Offerings (TOV-160, FR-05.05). The TRANSACTIONAL half of
 * the settlement migration; the `offering_bids` clearing-walk index is split into the separate
 * `…039` migration (`CREATE INDEX CONCURRENTLY`, `transaction:false`) so a long index build can never share
 * a txn with this table's FK on `offerings` (the FK takes a `ShareRowExclusive` on the core money row held
 * to COMMIT; combined with a minutes-long build it would write-block `offerings`).
 *
 * Three concerns, all in one txn:
 *
 * 1. `offering_clearing_audit` — the append-only settlement snapshot (the regulatory money artifact the
 *    ticket names). `bids_snapshot` is the exact sorted-walk input, `allocation_map` the winners passed to
 *    `close_and_settle`. Aggregate amounts (`proceeds/platform_fee/artist_net`) are sums over winners whose
 *    true domain is on-chain i128 → capped at 2^127−1 (NOT the per-unit 2^96−1). The floor split is asserted
 *    with `div()` (integer truncation) to MATCH the contract's `proceeds*300/10000` floor (`contract.rs:393`)
 *    — numeric `/` rounds and would mismatch. A PLAIN `UNIQUE(offering_id)` (not partial) is the one-settle-
 *    per-offering guard that survives a soft-delete. A distinct-named append-only trigger (must NOT collide
 *    with `034`'s `fn_offering_approvals_append_only`).
 *
 * 2. `offering_bids` gains the SETTLE terminals `won`/`lost` (widened `CHK_bid_status` + guard trigger
 *    `escrowed → won|lost`), plus the self-describing `allocated_count`/`settle_refund_stroops` stamps
 *    (write-once, present iff settled) so a bid row answers "what did I win / get refunded" without a jsonb
 *    join — the read-model fix (the forward-only trigger would otherwise REJECT the flip, leaving rows stuck
 *    `escrowed` = an accounting double-count). No index rebuild: `won`/`lost` are terminal so they fall out
 *    of the active-slot predicate automatically; the idem belt is moot on a settled offering (no new bid can
 *    be inserted — submit requires `opened`, and the idem hash is offering-scoped).
 *
 * 3. `offerings` gains `settle_failed_at`/`settle_failure_reason` so a terminally-failed settlement is
 *    distinguishable from an in-progress one at `GET :id` (both otherwise sit in `subscribed`). Cleared on a
 *    re-drive → NOT write-once (no trigger on `offerings`, a mutable CAS row).
 *
 * `down()` is fail-CLOSED (prod-guarded): `offering_clearing_audit` records irreversible settlement money
 * provenance. No byte-verbatim ritual — the append-only fn is net-new (replaces nothing); the `offering_bids`
 * guard fn is restored to its `037` body — SEMANTICALLY identical (the machine + all checks), though the
 * leading indentation differs from 037's in-method template, so `pg_proc.prosrc` is not byte-identical (#337;
 * dev/test-only, `down()` is prod-guarded, and nothing asserts prosrc equality) — then the
 * narrow `037` `CHK_bid_status` is re-added (ABORTS the revert if any won/lost row exists).
 */
export class AddOfferingClearingAudit1716000000038 implements MigrationInterface {
  name = 'AddOfferingClearingAudit1716000000038';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET lock_timeout = '3s'`);

    // ── 1. offering_clearing_audit (append-only settlement snapshot) ──────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "offering_clearing_audit" (
        "id"                    uuid          NOT NULL DEFAULT gen_random_uuid(),
        "offering_id"           uuid          NOT NULL,
        "clearing_price_stroops" numeric(39,0) NOT NULL,
        "public_float"          numeric(39,0) NOT NULL,
        "total_demand"          numeric(39,0) NOT NULL,
        "proceeds_stroops"      numeric(39,0) NOT NULL,
        "platform_fee_stroops"  numeric(39,0) NOT NULL,
        "artist_net_stroops"    numeric(39,0) NOT NULL,
        "bids_snapshot"         jsonb         NOT NULL,
        "allocation_map"        jsonb         NOT NULL,
        "settlement_tx_hash"    char(64),
        "settled_ledger"        bigint,
        "adopted"               boolean       NOT NULL DEFAULT false,
        "cleared_at"            timestamptz   NOT NULL DEFAULT now(),
        "created_at"            timestamptz   NOT NULL DEFAULT now(),
        "updated_at"            timestamptz   NOT NULL DEFAULT now(),
        "deleted_at"            timestamptz,
        CONSTRAINT "PK_offering_clearing_audit" PRIMARY KEY ("id"),
        CONSTRAINT "FK_offering_clearing_audit_offering" FOREIGN KEY ("offering_id")
          REFERENCES "offerings" ("id") ON DELETE RESTRICT,
        -- PLAIN unique (not partial): one settlement per offering EVER, even after a soft-delete (F3).
        CONSTRAINT "UQ_offering_clearing_audit_offering" UNIQUE ("offering_id"),
        -- clearing price is a per-UNIT stroop amount, 2^96-1 ceiling; must be positive (mirrors the
        -- contract's clearing_price > 0 winner-fairness gate).
        CONSTRAINT "CHK_clearing_price"
          CHECK ("clearing_price_stroops" > 0 AND "clearing_price_stroops" <= 79228162514264337593543950335),
        CONSTRAINT "CHK_clearing_float_positive" CHECK ("public_float" > 0),
        -- fully subscribed: demand met or exceeded the float (undersubscribed never settles).
        CONSTRAINT "CHK_clearing_demand" CHECK ("total_demand" >= "public_float"),
        -- aggregate amounts are i128 sums → 2^127−1 ceiling (capping at 2^96−1 would 500 a large settlement).
        CONSTRAINT "CHK_clearing_proceeds_cap"
          CHECK ("proceeds_stroops" >= 0 AND "proceeds_stroops" <= 170141183460469231731687303715884105727),
        CONSTRAINT "CHK_clearing_fee_cap"
          CHECK ("platform_fee_stroops" >= 0 AND "platform_fee_stroops" <= 170141183460469231731687303715884105727),
        CONSTRAINT "CHK_clearing_net_cap"
          CHECK ("artist_net_stroops" >= 0 AND "artist_net_stroops" <= 170141183460469231731687303715884105727),
        -- 3% floor split MUST match the contract (proceeds*300/10000 FLOOR); div() truncates, numeric / rounds.
        CONSTRAINT "CHK_clearing_fee_floor"
          CHECK ("platform_fee_stroops" = div("proceeds_stroops" * 300, 10000)),
        CONSTRAINT "CHK_clearing_net_split"
          CHECK ("artist_net_stroops" = "proceeds_stroops" - "platform_fee_stroops"),
        CONSTRAINT "CHK_clearing_txhash"
          CHECK ("settlement_tx_hash" IS NULL OR "settlement_tx_hash" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "CHK_clearing_ledger" CHECK ("settled_ledger" IS NULL OR "settled_ledger" > 0)
      )
    `);

    // Append-only, SELECTIVE (mirrors 034 fn_offering_approvals_append_only, DISTINCT name — must not collide).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "fn_offering_clearing_audit_append_only"() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'offering_clearing_audit is append-only (DELETE not allowed)' USING ERRCODE = 'raise_exception';
        END IF;
        -- every business column is immutable (the settled snapshot is written once, never edited)
        IF NEW."id" <> OLD."id" OR NEW."offering_id" <> OLD."offering_id"
           OR NEW."clearing_price_stroops" <> OLD."clearing_price_stroops"
           OR NEW."public_float" <> OLD."public_float" OR NEW."total_demand" <> OLD."total_demand"
           OR NEW."proceeds_stroops" <> OLD."proceeds_stroops"
           OR NEW."platform_fee_stroops" <> OLD."platform_fee_stroops"
           OR NEW."artist_net_stroops" <> OLD."artist_net_stroops"
           OR NEW."bids_snapshot" <> OLD."bids_snapshot" OR NEW."allocation_map" <> OLD."allocation_map"
           OR NEW."settlement_tx_hash" IS DISTINCT FROM OLD."settlement_tx_hash"
           OR NEW."settled_ledger" IS DISTINCT FROM OLD."settled_ledger"
           OR NEW."adopted" <> OLD."adopted" OR NEW."cleared_at" <> OLD."cleared_at"
           OR NEW."created_at" <> OLD."created_at" THEN
          RAISE EXCEPTION 'offering_clearing_audit immutable columns cannot change' USING ERRCODE = 'raise_exception';
        END IF;
        -- FULLY immutable: soft-delete is NOT allowed either (#337). This is a retention-obligated
        -- settlement money artifact; permitting a soft-delete would make the row invisible to the read model
        -- (findByOfferingId filters deleted_at IS NULL) while the plain UNIQUE(offering_id) still blocks a
        -- re-settlement — i.e. a settled offering with an irretrievable snapshot. Reject any deleted_at change.
        IF NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at" THEN
          RAISE EXCEPTION 'offering_clearing_audit is immutable (soft-delete not allowed)' USING ERRCODE = 'raise_exception';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_offering_clearing_audit_append_only"
        BEFORE UPDATE OR DELETE ON "offering_clearing_audit"
        FOR EACH ROW EXECUTE FUNCTION "fn_offering_clearing_audit_append_only"()
    `);

    // ── 2. offering_bids: won/lost terminals + self-describing settle stamps ───────────────────────────
    await queryRunner.query(`
      ALTER TABLE "offering_bids"
        ADD COLUMN "allocated_count"        numeric(39,0),
        ADD COLUMN "settle_refund_stroops"  numeric(39,0)
    `);

    // Widen the status vocabulary (strict superset → NOT VALID + VALIDATE can't fail).
    await queryRunner.query(`ALTER TABLE "offering_bids" DROP CONSTRAINT "CHK_bid_status"`);
    await queryRunner.query(`
      ALTER TABLE "offering_bids" ADD CONSTRAINT "CHK_bid_status"
        CHECK ("status" IN ('submitted','escrowed','failed','canceling','canceled','won','lost')) NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "offering_bids" VALIDATE CONSTRAINT "CHK_bid_status"`);

    // A settled row (won|lost) carries BOTH stamps; a non-settled row carries NEITHER (clean belt).
    await queryRunner.query(`
      ALTER TABLE "offering_bids" ADD CONSTRAINT "CHK_bid_settled_stamped"
        CHECK ("status" NOT IN ('won','lost')
               OR ("allocated_count" IS NOT NULL AND "settle_refund_stroops" IS NOT NULL)) NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "offering_bids" VALIDATE CONSTRAINT "CHK_bid_settled_stamped"`);
    await queryRunner.query(`
      ALTER TABLE "offering_bids" ADD CONSTRAINT "CHK_bid_unsettled_clean"
        CHECK ("status" IN ('won','lost')
               OR ("allocated_count" IS NULL AND "settle_refund_stroops" IS NULL)) NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "offering_bids" VALIDATE CONSTRAINT "CHK_bid_unsettled_clean"`);
    // won ⇒ allocated > 0; lost ⇒ allocated = 0; allocated ≤ count; refund ≤ 2^96−1.
    await queryRunner.query(`
      ALTER TABLE "offering_bids" ADD CONSTRAINT "CHK_bid_won_alloc"
        CHECK ("status" <> 'won' OR ("allocated_count" > 0 AND "allocated_count" <= "count")) NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "offering_bids" VALIDATE CONSTRAINT "CHK_bid_won_alloc"`);
    await queryRunner.query(`
      ALTER TABLE "offering_bids" ADD CONSTRAINT "CHK_bid_lost_alloc"
        CHECK ("status" <> 'lost' OR "allocated_count" = 0) NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "offering_bids" VALIDATE CONSTRAINT "CHK_bid_lost_alloc"`);
    // 2^96-1 cap. NB (#337): this MUST track migration 036's CHK_bid_escrow_cap — a loser's full refund is
    // its escrow_amount_stroops (price*count), which 036 already bounds to 2^96-1, so this can never trip
    // today. If a future migration ever raises the escrow cap toward the i128 domain (2^127-1), raise this
    // one in lockstep or flipRemainingEscrowedToLost would fail (23514) on a large loser and wedge settlement.
    await queryRunner.query(`
      ALTER TABLE "offering_bids" ADD CONSTRAINT "CHK_bid_settle_refund_cap"
        CHECK ("settle_refund_stroops" IS NULL OR "settle_refund_stroops" <= 79228162514264337593543950335) NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "offering_bids" VALIDATE CONSTRAINT "CHK_bid_settle_refund_cap"`);

    // Replace the guard function: add `escrowed → won|lost` to the forward machine and make the two settle
    // stamps write-once. Body is the 037 body + the two new legs (comments kept for a clean prosrc).
    await queryRunner.query(FN_GUARD_038);

    // ── 3. offerings: terminal-settle-failure signal for GET :id ──────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "offerings"
        ADD COLUMN "settle_failed_at"      timestamptz,
        ADD COLUMN "settle_failure_reason" varchar(200)
    `);
    // Both present or both absent (the reason accompanies the timestamp; cleared together on re-drive).
    await queryRunner.query(`
      ALTER TABLE "offerings" ADD CONSTRAINT "CHK_off_settle_fail_clean"
        CHECK (("settle_failed_at" IS NULL) = ("settle_failure_reason" IS NULL)) NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "offerings" VALIDATE CONSTRAINT "CHK_off_settle_fail_clean"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        `Refusing to revert AddOfferingClearingAudit1716000000038 outside development/test (NODE_ENV=` +
          `${process.env.NODE_ENV ?? 'unset'}): "offering_clearing_audit" records irreversible settlement ` +
          'money provenance and "offering_bids" carries won/lost settlement allocations. ' +
          'Roll back the deployment instead.',
      );
    }
    await queryRunner.query(`SET lock_timeout = '3s'`);

    // 1) Restore the 037 guard body byte-for-byte FIRST (must not reference the columns we drop below).
    await queryRunner.query(FN_GUARD_037);

    // 2) Re-add the narrow 037 status CHECK (validated) — ABORTS the revert if any won/lost row exists.
    await queryRunner.query(`ALTER TABLE "offering_bids" DROP CONSTRAINT "CHK_bid_status"`);
    await queryRunner.query(`
      ALTER TABLE "offering_bids" ADD CONSTRAINT "CHK_bid_status"
        CHECK ("status" IN ('submitted','escrowed','failed','canceling','canceled'))
    `);

    // 3) Drop the settle CHECKs + columns on offering_bids.
    await queryRunner.query(`ALTER TABLE "offering_bids" DROP CONSTRAINT "CHK_bid_settle_refund_cap"`);
    await queryRunner.query(`ALTER TABLE "offering_bids" DROP CONSTRAINT "CHK_bid_lost_alloc"`);
    await queryRunner.query(`ALTER TABLE "offering_bids" DROP CONSTRAINT "CHK_bid_won_alloc"`);
    await queryRunner.query(`ALTER TABLE "offering_bids" DROP CONSTRAINT "CHK_bid_unsettled_clean"`);
    await queryRunner.query(`ALTER TABLE "offering_bids" DROP CONSTRAINT "CHK_bid_settled_stamped"`);
    await queryRunner.query(`
      ALTER TABLE "offering_bids"
        DROP COLUMN "settle_refund_stroops",
        DROP COLUMN "allocated_count"
    `);

    // 4) offerings settle-failure columns.
    await queryRunner.query(`ALTER TABLE "offerings" DROP CONSTRAINT "CHK_off_settle_fail_clean"`);
    await queryRunner.query(`
      ALTER TABLE "offerings"
        DROP COLUMN "settle_failure_reason",
        DROP COLUMN "settle_failed_at"
    `);

    // 5) offering_clearing_audit (net-new — drop trigger, fn, table).
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_offering_clearing_audit_append_only" ON "offering_clearing_audit"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS "fn_offering_clearing_audit_append_only"()`);
    await queryRunner.query(`DROP TABLE IF EXISTS "offering_clearing_audit"`);
  }
}

// The 038 guard body: 037's machine + `escrowed → won|lost` + write-once allocated_count/settle_refund_stroops.
const FN_GUARD_038 = `
  CREATE OR REPLACE FUNCTION "fn_offering_bids_guard"() RETURNS trigger AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'offering_bids is append-only (DELETE not allowed)' USING ERRCODE = 'raise_exception';
    END IF;
    -- immutable columns can never change
    IF NEW."id" <> OLD."id" OR NEW."offering_id" <> OLD."offering_id"
       OR NEW."collector_sub" <> OLD."collector_sub" OR NEW."collector_wallet" <> OLD."collector_wallet"
       OR NEW."price_stroops" <> OLD."price_stroops" OR NEW."count" <> OLD."count"
       OR NEW."idempotency_hash" <> OLD."idempotency_hash" OR NEW."created_at" <> OLD."created_at" THEN
      RAISE EXCEPTION 'offering_bids immutable columns cannot change' USING ERRCODE = 'raise_exception';
    END IF;
    -- soft-delete is final and one-way
    IF OLD."deleted_at" IS NOT NULL THEN
      RAISE EXCEPTION 'offering_bids soft-delete is final' USING ERRCODE = 'raise_exception';
    END IF;
    -- forward-only status machine (submit escrow + cancel refund + settle); every other move is rejected
    IF OLD."status" <> NEW."status"
       AND NOT (
            (OLD."status" = 'submitted' AND NEW."status" IN ('escrowed','failed'))
         OR (OLD."status" = 'escrowed'  AND NEW."status" IN ('canceling','won','lost'))
         OR (OLD."status" = 'canceling' AND NEW."status" IN ('canceled','escrowed'))
       ) THEN
      RAISE EXCEPTION 'offering_bids illegal status transition % -> %', OLD."status", NEW."status"
        USING ERRCODE = 'raise_exception';
    END IF;
    -- escrow stamps are write-once (never rewrite a landed chain id / tx hash)
    IF OLD."chain_bid_id" IS NOT NULL AND NEW."chain_bid_id" IS DISTINCT FROM OLD."chain_bid_id" THEN
      RAISE EXCEPTION 'offering_bids chain_bid_id is write-once' USING ERRCODE = 'raise_exception';
    END IF;
    IF OLD."escrow_tx_hash" IS NOT NULL AND NEW."escrow_tx_hash" IS DISTINCT FROM OLD."escrow_tx_hash" THEN
      RAISE EXCEPTION 'offering_bids escrow_tx_hash is write-once' USING ERRCODE = 'raise_exception';
    END IF;
    -- refund stamps are write-once (TOV-158)
    IF OLD."refund_tx_hash" IS NOT NULL AND NEW."refund_tx_hash" IS DISTINCT FROM OLD."refund_tx_hash" THEN
      RAISE EXCEPTION 'offering_bids refund_tx_hash is write-once' USING ERRCODE = 'raise_exception';
    END IF;
    IF OLD."canceled_at" IS NOT NULL AND NEW."canceled_at" IS DISTINCT FROM OLD."canceled_at" THEN
      RAISE EXCEPTION 'offering_bids canceled_at is write-once' USING ERRCODE = 'raise_exception';
    END IF;
    -- settle stamps are write-once (TOV-160)
    IF OLD."allocated_count" IS NOT NULL AND NEW."allocated_count" IS DISTINCT FROM OLD."allocated_count" THEN
      RAISE EXCEPTION 'offering_bids allocated_count is write-once' USING ERRCODE = 'raise_exception';
    END IF;
    IF OLD."settle_refund_stroops" IS NOT NULL
       AND NEW."settle_refund_stroops" IS DISTINCT FROM OLD."settle_refund_stroops" THEN
      RAISE EXCEPTION 'offering_bids settle_refund_stroops is write-once' USING ERRCODE = 'raise_exception';
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql
`;

// 037's guard body (semantically identical; indentation differs from 037's in-method template, so prosrc is
// not byte-identical — see the header note, #337). Restored by down() before the settle columns are dropped.
const FN_GUARD_037 = `
  CREATE OR REPLACE FUNCTION "fn_offering_bids_guard"() RETURNS trigger AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'offering_bids is append-only (DELETE not allowed)' USING ERRCODE = 'raise_exception';
    END IF;
    -- immutable columns can never change
    IF NEW."id" <> OLD."id" OR NEW."offering_id" <> OLD."offering_id"
       OR NEW."collector_sub" <> OLD."collector_sub" OR NEW."collector_wallet" <> OLD."collector_wallet"
       OR NEW."price_stroops" <> OLD."price_stroops" OR NEW."count" <> OLD."count"
       OR NEW."idempotency_hash" <> OLD."idempotency_hash" OR NEW."created_at" <> OLD."created_at" THEN
      RAISE EXCEPTION 'offering_bids immutable columns cannot change' USING ERRCODE = 'raise_exception';
    END IF;
    -- soft-delete is final and one-way
    IF OLD."deleted_at" IS NOT NULL THEN
      RAISE EXCEPTION 'offering_bids soft-delete is final' USING ERRCODE = 'raise_exception';
    END IF;
    -- forward-only status machine (submit escrow + cancel refund); every other move is rejected
    IF OLD."status" <> NEW."status"
       AND NOT (
            (OLD."status" = 'submitted' AND NEW."status" IN ('escrowed','failed'))
         OR (OLD."status" = 'escrowed'  AND NEW."status" = 'canceling')
         OR (OLD."status" = 'canceling' AND NEW."status" IN ('canceled','escrowed'))
       ) THEN
      RAISE EXCEPTION 'offering_bids illegal status transition % -> %', OLD."status", NEW."status"
        USING ERRCODE = 'raise_exception';
    END IF;
    -- escrow stamps are write-once (never rewrite a landed chain id / tx hash)
    IF OLD."chain_bid_id" IS NOT NULL AND NEW."chain_bid_id" IS DISTINCT FROM OLD."chain_bid_id" THEN
      RAISE EXCEPTION 'offering_bids chain_bid_id is write-once' USING ERRCODE = 'raise_exception';
    END IF;
    IF OLD."escrow_tx_hash" IS NOT NULL AND NEW."escrow_tx_hash" IS DISTINCT FROM OLD."escrow_tx_hash" THEN
      RAISE EXCEPTION 'offering_bids escrow_tx_hash is write-once' USING ERRCODE = 'raise_exception';
    END IF;
    -- refund stamps are write-once (TOV-158)
    IF OLD."refund_tx_hash" IS NOT NULL AND NEW."refund_tx_hash" IS DISTINCT FROM OLD."refund_tx_hash" THEN
      RAISE EXCEPTION 'offering_bids refund_tx_hash is write-once' USING ERRCODE = 'raise_exception';
    END IF;
    IF OLD."canceled_at" IS NOT NULL AND NEW."canceled_at" IS DISTINCT FROM OLD."canceled_at" THEN
      RAISE EXCEPTION 'offering_bids canceled_at is write-once' USING ERRCODE = 'raise_exception';
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql
`;
