import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Settlement audit fidelity (TOV-165, FR-05.06). Additive, transactional. Two parts:
 *
 * 1. `offerings` gains the supply/retention SNAPSHOT frozen at planning — `total_supply_stroops`,
 *    `artist_retention_stroops`, `treasury_retention_stroops` — the raw inputs of
 *    `public_float = total_supply − artist_retention − treasury_retention` (`CHK_off_public_float_decomposition`).
 *    Mirrors the `public_float` / `snapshot_artist_address` freeze so settlement never re-reads the mutable
 *    `fraction_contracts` (no append-only guard there) and the mint invariant is temporally consistent.
 *
 * 2. `offering_clearing_audit` gains the mint-conservation columns — `cleared_allocations_stroops`,
 *    `absorbed_leftover_stroops`, `total_supply_stroops`, `artist_retention_stroops`,
 *    `treasury_retention_stroops` — copied from the offering snapshot (+ the INDEPENDENT `Σ allocated`). Three
 *    INDEPENDENT teeth-bearing CHECKs, whose conjunction implies the mint invariant `Σ allocated +
 *    artist_retention + treasury_retention + absorbed_leftover == total_supply`:
 *      • `CHK_clearing_float_decomposition`  public_float = total_supply − artist_retention − treasury_retention
 *      • `CHK_clearing_alloc_eq_float`       cleared_allocations = public_float   (independent cross-check)
 *      • `CHK_clearing_absorbed_zero`        absorbed_leftover = 0                (FR-04.06 relaxes this later)
 *
 * ⚠️ ORDERING IS A REVIEW GATE: the append-only guard `fn_offering_clearing_audit_append_only` enumerates its
 * immutable columns by name, so the backfill UPDATE of the 5 new columns MUST run BEFORE the guard is
 * re-declared to include them — otherwise the re-armed guard rejects its own backfill (self-lockout). Do not
 * reorder `CREATE OR REPLACE FUNCTION` above the backfill.
 *
 * NULL-safe pre-VALIDATE assertions abort LOUDLY if any backfilled row is NULL or violates a CHECK (retention
 * amounts are nullable on non-deployed contracts, and `fraction_contracts` money columns are technically
 * mutable) rather than surfacing an opaque `23502`/`23514` at SET NOT NULL / VALIDATE.
 *
 * `down()` is fail-CLOSED (prod-guarded): the audit table records irreversible settlement money provenance.
 */
export class AddOfferingSettlementSnapshotColumns1716000000040 implements MigrationInterface {
  name = 'AddOfferingSettlementSnapshotColumns1716000000040';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // SET LOCAL (not plain SET): auto-resets at COMMIT so this 3s timeout can't leak across TypeORM's shared
    // migration:run connection into a later transaction:false CONCURRENTLY migration (the #318 leak).
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);

    // ── 1. offerings: supply/retention snapshot (nullable → backfill → assert → NOT NULL → decomposition CHECK) ──
    await queryRunner.query(`
      ALTER TABLE "offerings"
        ADD COLUMN "total_supply_stroops"       numeric(39,0),
        ADD COLUMN "artist_retention_stroops"   numeric(39,0),
        ADD COLUMN "treasury_retention_stroops" numeric(39,0)
    `);
    // Backfill from the (possibly soft-deleted, hence NO deleted_at filter) fraction_contract; the composite FK
    // (ON DELETE RESTRICT) guarantees the row exists. offerings.fraction_contract_id is NOT NULL.
    await queryRunner.query(`
      UPDATE "offerings" o
         SET "total_supply_stroops"       = fc."total_supply",
             "artist_retention_stroops"   = fc."artist_retention_amount",
             "treasury_retention_stroops" = fc."treasury_retention_amount"
        FROM "fraction_contracts" fc
       WHERE o."fraction_contract_id" = fc."id"
    `);
    // Fail LOUD on any NULL (NULL retention on a non-deployed contract) or decomposition drift, so the abort
    // carries a diagnostic instead of an opaque 23502 at SET NOT NULL / 23514 at VALIDATE.
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM "offerings"
           WHERE "total_supply_stroops" IS NULL OR "artist_retention_stroops" IS NULL
              OR "treasury_retention_stroops" IS NULL
              OR "public_float" <> "total_supply_stroops" - "artist_retention_stroops" - "treasury_retention_stroops"
        ) THEN
          RAISE EXCEPTION 'TOV-165 offerings snapshot backfill violation (NULL retention or public_float decomposition mismatch)';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE "offerings"
        ALTER COLUMN "total_supply_stroops"       SET NOT NULL,
        ALTER COLUMN "artist_retention_stroops"   SET NOT NULL,
        ALTER COLUMN "treasury_retention_stroops" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "offerings" ADD CONSTRAINT "CHK_off_public_float_decomposition"
        CHECK ("public_float" = "total_supply_stroops" - "artist_retention_stroops" - "treasury_retention_stroops") NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "offerings" VALIDATE CONSTRAINT "CHK_off_public_float_decomposition"`);

    // ── 2. offering_clearing_audit: mint-conservation columns (backfill FROM the now-populated offering) ──
    await queryRunner.query(`
      ALTER TABLE "offering_clearing_audit"
        ADD COLUMN "cleared_allocations_stroops" numeric(39,0),
        ADD COLUMN "absorbed_leftover_stroops"   numeric(39,0),
        ADD COLUMN "total_supply_stroops"        numeric(39,0),
        ADD COLUMN "artist_retention_stroops"    numeric(39,0),
        ADD COLUMN "treasury_retention_stroops"  numeric(39,0)
    `);
    // Backfill BEFORE the guard re-declaration (the still-active 038 guard ignores these new columns, so the
    // UPDATE passes; the re-armed guard below would reject flipping NULL→value). cleared_allocations is
    // re-derived as the INDEPENDENT Σ of the winners' allocatedCount from the frozen allocation_map jsonb —
    // NOT copied from public_float — so `CHK_clearing_alloc_eq_float` (and the assertion below) is a genuine
    // cross-check for historical rows too (a corrupted allocation_map ⇒ Σ<>public_float ⇒ loud abort), matching
    // the forward/worker path's independent Σ. absorbed_leftover ≡ 0 today. COALESCE guards an empty map.
    await queryRunner.query(`
      UPDATE "offering_clearing_audit" a
         SET "total_supply_stroops"        = o."total_supply_stroops",
             "artist_retention_stroops"    = o."artist_retention_stroops",
             "treasury_retention_stroops"  = o."treasury_retention_stroops",
             "cleared_allocations_stroops" = COALESCE(
               (SELECT sum((elem->>'allocatedCount')::numeric)
                  FROM jsonb_array_elements(a."allocation_map") AS elem), 0),
             "absorbed_leftover_stroops"   = 0
        FROM "offerings" o
       WHERE a."offering_id" = o."id"
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM "offering_clearing_audit"
           WHERE "cleared_allocations_stroops" IS NULL OR "absorbed_leftover_stroops" IS NULL
              OR "total_supply_stroops" IS NULL OR "artist_retention_stroops" IS NULL
              OR "treasury_retention_stroops" IS NULL
              OR "cleared_allocations_stroops" <> "public_float"
              OR "absorbed_leftover_stroops" <> 0
              OR "public_float" <> "total_supply_stroops" - "artist_retention_stroops" - "treasury_retention_stroops"
        ) THEN
          RAISE EXCEPTION 'TOV-165 audit snapshot backfill violation (NULL, alloc<>float, absorbed<>0, or decomposition mismatch)';
        END IF;
      END $$
    `);
    // Re-arm the append-only guard to make the 5 new columns immutable too (AFTER the backfill).
    await queryRunner.query(FN_CLEARING_GUARD_040);
    await queryRunner.query(`
      ALTER TABLE "offering_clearing_audit"
        ALTER COLUMN "cleared_allocations_stroops" SET NOT NULL,
        ALTER COLUMN "absorbed_leftover_stroops"   SET NOT NULL,
        ALTER COLUMN "total_supply_stroops"        SET NOT NULL,
        ALTER COLUMN "artist_retention_stroops"    SET NOT NULL,
        ALTER COLUMN "treasury_retention_stroops"  SET NOT NULL
    `);
    // Three INDEPENDENT teeth-bearing CHECKs — their conjunction implies the mint invariant.
    await queryRunner.query(`
      ALTER TABLE "offering_clearing_audit" ADD CONSTRAINT "CHK_clearing_float_decomposition"
        CHECK ("public_float" = "total_supply_stroops" - "artist_retention_stroops" - "treasury_retention_stroops") NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "offering_clearing_audit" VALIDATE CONSTRAINT "CHK_clearing_float_decomposition"`);
    await queryRunner.query(`
      ALTER TABLE "offering_clearing_audit" ADD CONSTRAINT "CHK_clearing_alloc_eq_float"
        CHECK ("cleared_allocations_stroops" = "public_float") NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "offering_clearing_audit" VALIDATE CONSTRAINT "CHK_clearing_alloc_eq_float"`);
    await queryRunner.query(`
      ALTER TABLE "offering_clearing_audit" ADD CONSTRAINT "CHK_clearing_absorbed_zero"
        CHECK ("absorbed_leftover_stroops" = 0) NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "offering_clearing_audit" VALIDATE CONSTRAINT "CHK_clearing_absorbed_zero"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error(
        `Refusing to revert AddOfferingSettlementSnapshotColumns1716000000040 outside development/test ` +
          `(NODE_ENV=${process.env.NODE_ENV ?? 'unset'}): "offering_clearing_audit" records irreversible ` +
          'settlement money provenance. Roll back the deployment instead.',
      );
    }
    await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);

    // 1) Drop the 3 audit CHECKs.
    await queryRunner.query(`ALTER TABLE "offering_clearing_audit" DROP CONSTRAINT "CHK_clearing_absorbed_zero"`);
    await queryRunner.query(`ALTER TABLE "offering_clearing_audit" DROP CONSTRAINT "CHK_clearing_alloc_eq_float"`);
    await queryRunner.query(`ALTER TABLE "offering_clearing_audit" DROP CONSTRAINT "CHK_clearing_float_decomposition"`);
    // 2) Restore the 038 guard body FIRST (must no longer reference the 5 columns we drop next). Semantically
    //    identical to 038's install; prosrc byte-identity is NOT required (dev/test-only, #337).
    await queryRunner.query(FN_CLEARING_GUARD_038);
    // 3) Drop the audit mint-conservation columns.
    await queryRunner.query(`
      ALTER TABLE "offering_clearing_audit"
        DROP COLUMN "treasury_retention_stroops",
        DROP COLUMN "artist_retention_stroops",
        DROP COLUMN "total_supply_stroops",
        DROP COLUMN "absorbed_leftover_stroops",
        DROP COLUMN "cleared_allocations_stroops"
    `);
    // 4) offerings decomposition CHECK + snapshot columns.
    await queryRunner.query(`ALTER TABLE "offerings" DROP CONSTRAINT "CHK_off_public_float_decomposition"`);
    await queryRunner.query(`
      ALTER TABLE "offerings"
        DROP COLUMN "treasury_retention_stroops",
        DROP COLUMN "artist_retention_stroops",
        DROP COLUMN "total_supply_stroops"
    `);
  }
}

// The 040 guard body: 038's fn_offering_clearing_audit_append_only + the 5 TOV-165 columns in the immutable
// enumeration (all NOT NULL post-migration → `<>`, not IS DISTINCT FROM).
const FN_CLEARING_GUARD_040 = `
  CREATE OR REPLACE FUNCTION "fn_offering_clearing_audit_append_only"() RETURNS trigger AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'offering_clearing_audit is append-only (DELETE not allowed)' USING ERRCODE = 'raise_exception';
    END IF;
    IF NEW."id" <> OLD."id" OR NEW."offering_id" <> OLD."offering_id"
       OR NEW."clearing_price_stroops" <> OLD."clearing_price_stroops"
       OR NEW."public_float" <> OLD."public_float" OR NEW."total_demand" <> OLD."total_demand"
       OR NEW."proceeds_stroops" <> OLD."proceeds_stroops"
       OR NEW."platform_fee_stroops" <> OLD."platform_fee_stroops"
       OR NEW."artist_net_stroops" <> OLD."artist_net_stroops"
       OR NEW."cleared_allocations_stroops" <> OLD."cleared_allocations_stroops"
       OR NEW."absorbed_leftover_stroops" <> OLD."absorbed_leftover_stroops"
       OR NEW."total_supply_stroops" <> OLD."total_supply_stroops"
       OR NEW."artist_retention_stroops" <> OLD."artist_retention_stroops"
       OR NEW."treasury_retention_stroops" <> OLD."treasury_retention_stroops"
       OR NEW."bids_snapshot" <> OLD."bids_snapshot" OR NEW."allocation_map" <> OLD."allocation_map"
       OR NEW."settlement_tx_hash" IS DISTINCT FROM OLD."settlement_tx_hash"
       OR NEW."settled_ledger" IS DISTINCT FROM OLD."settled_ledger"
       OR NEW."adopted" <> OLD."adopted" OR NEW."cleared_at" <> OLD."cleared_at"
       OR NEW."created_at" <> OLD."created_at" THEN
      RAISE EXCEPTION 'offering_clearing_audit immutable columns cannot change' USING ERRCODE = 'raise_exception';
    END IF;
    IF NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at" THEN
      RAISE EXCEPTION 'offering_clearing_audit is immutable (soft-delete not allowed)' USING ERRCODE = 'raise_exception';
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql
`;

// The 038 guard body (restored by down() before the 5 columns are dropped). Semantically identical to 038's
// install; leading indentation may differ, so pg_proc.prosrc is not byte-identical (#337; dev/test-only).
const FN_CLEARING_GUARD_038 = `
  CREATE OR REPLACE FUNCTION "fn_offering_clearing_audit_append_only"() RETURNS trigger AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'offering_clearing_audit is append-only (DELETE not allowed)' USING ERRCODE = 'raise_exception';
    END IF;
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
    IF NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at" THEN
      RAISE EXCEPTION 'offering_clearing_audit is immutable (soft-delete not allowed)' USING ERRCODE = 'raise_exception';
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql
`;
