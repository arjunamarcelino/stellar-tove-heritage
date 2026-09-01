import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createTestingModule, truncateTables } from '../../setup';

/**
 * DB-level guard for the TOV-152 `offerings` table (FR-05.01). Verifies the migration's constraints and
 * the partial-unique index the service leans on (`UQ_offerings_active_per_artwork`) directly at the SQL
 * layer — raw `dataSource.query` against the pre-migrated `tove_test` DB, no Nest feature modules needed.
 *
 * This suite is the drift-guard for the active-status set: the migration's WHERE-clause can't reference
 * the TS `OFFERING_STATUSES` tuple, so a future M05 FR that adds a non-terminal status must update both.
 *
 * NOTE: requires the local `tove_test` DB migrated (`yarn db:test:setup`).
 */

// Postgres SQLSTATEs asserted below.
const UNIQUE_VIOLATION = '23505';
const FK_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

// 2^96 (one past the CHK_off_band / CHK_off_float ceiling of 2^96 - 1).
const OVER_MAX_STROOPS = '79228162514264337593543950336';

interface PgError {
  code?: string;
  constraint?: string;
  driverError?: { code?: string; constraint?: string };
}

/** Run `fn`, assert it rejected with the given SQLSTATE (+ optional constraint name). */
async function expectPgError(fn: () => Promise<unknown>, code: string, constraint?: string): Promise<void> {
  let err: PgError | undefined;
  try {
    await fn();
  } catch (e) {
    err = e as PgError;
  }
  expect(err, 'expected the query to reject').toBeDefined();
  const actualCode = err!.code ?? err!.driverError?.code;
  const actualConstraint = err!.constraint ?? err!.driverError?.constraint;
  expect(actualCode).toBe(code);
  if (constraint !== undefined) {
    expect(actualConstraint).toBe(constraint);
  }
}

describe('offerings DB constraints (integration)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;

  beforeAll(async () => {
    moduleRef = await createTestingModule();
    ds = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await truncateTables(ds);
  });

  afterEach(async () => {
    await truncateTables(ds);
  });

  async function q<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
    return ds.query(text, params);
  }

  const ADMIN_SUB = '00000000-0000-4000-8000-00000000ad11';

  /** Seed a user → artwork → DEPLOYED fraction_contract; return the parent ids for offerings. */
  async function seedDeployedArtwork(): Promise<{ artworkId: string; fractionContractId: string }> {
    const users = await q<{ id: string }>(
      `INSERT INTO users (is_active, kyc_status) VALUES (true, 'not_submitted') RETURNING id`,
    );
    const artworks = await q<{ id: string }>(
      `INSERT INTO artworks (status, artist_user_id, title) VALUES ('fractionalized', $1, 'A') RETURNING id`,
      [users[0].id],
    );
    const artworkId = artworks[0].id;
    // A valid DEPLOYED row: token_address ^C[A-Z2-7]{55}$, wasm_hash 64-hex, symbol, name, artist_address,
    // total_supply > 0, retention amounts non-null (retentions <= total_supply per CHK_fc_retention_amounts).
    const contracts = await q<{ id: string }>(
      `INSERT INTO fraction_contracts (
         artwork_id, status, token_address, wasm_hash, token_name, token_symbol, artist_address,
         total_supply, artist_retention_pct, treasury_retention_pct,
         artist_retention_amount, treasury_retention_amount, artist_lockup_days, treasury_lockup_days
       ) VALUES ($1, 'deployed', $2, $3, 'ArtToken', 'ART', $4,
         '1000000', 10, 5, '100000', '50000', 365, 730)
       RETURNING id`,
      [
        artworkId,
        'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
        '7ad8c08d6e4d72dafba21c1b27b8908e974d725a46aa354491185ae6f26947cd',
        'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O',
      ],
    );
    return { artworkId, fractionContractId: contracts[0].id };
  }

  interface OfferingOverrides {
    artworkId?: string;
    fractionContractId?: string;
    status?: string;
    low?: string;
    high?: string;
    publicFloat?: string;
    windowOpenAt?: string;
    windowCloseAt?: string;
  }

  /** Insert one offering row with sensible valid defaults; override a single field to probe a constraint. */
  function insertOffering(
    parents: { artworkId: string; fractionContractId: string },
    o: OfferingOverrides = {},
  ): Promise<{ id: string }[]> {
    const status = o.status ?? 'planned';
    // TOV-154 CHK_off_approved_has_escrow: any post-approval status must carry an escrow address.
    const escrowAddress = ['approved', 'opened', 'subscribed', 'settled'].includes(status)
      ? 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
      : null;
    return q<{ id: string }>(
      `INSERT INTO offerings (
         artwork_id, fraction_contract_id, status, low_price_stroops, high_price_stroops,
         public_float, window_open_at, window_close_at, created_by_admin_sub, escrow_contract_address,
         total_supply_stroops, artist_retention_stroops, treasury_retention_stroops
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $6, '0', '0')
       RETURNING id`,
      [
        o.artworkId ?? parents.artworkId,
        o.fractionContractId ?? parents.fractionContractId,
        status,
        o.low ?? '50000000',
        o.high ?? '150000000',
        o.publicFloat ?? '850000',
        o.windowOpenAt ?? '2026-09-01T00:00:00Z',
        o.windowCloseAt ?? '2026-09-08T00:00:00Z',
        ADMIN_SUB,
        escrowAddress,
      ],
    );
  }

  describe('UQ_offerings_active_per_artwork (one active offering per artwork)', () => {
    it('rejects a second non-terminal offering for the same artwork (23505)', async () => {
      const parents = await seedDeployedArtwork();
      await insertOffering(parents); // first 'planned' — OK
      await expectPgError(
        () => insertOffering(parents), // second 'planned' — duplicate active
        UNIQUE_VIOLATION,
        'UQ_offerings_active_per_artwork',
      );
    });

    it("allows a fresh 'planned' offering after the prior one is 'settled' (terminal, excluded)", async () => {
      const parents = await seedDeployedArtwork();
      const first = await insertOffering(parents);
      // 'settled' is escrow-gated (CHK_off_approved_has_escrow) — supply an address.
      await q(
        `UPDATE offerings SET status='settled', escrow_contract_address='CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA' WHERE id=$1`,
        [first[0].id],
      );
      await expect(insertOffering(parents, { status: 'planned' })).resolves.toBeTruthy();
    });

    it("allows a fresh 'planned' offering after the prior one is 'canceled' (terminal, excluded)", async () => {
      const parents = await seedDeployedArtwork();
      const first = await insertOffering(parents);
      await q(`UPDATE offerings SET status='canceled' WHERE id=$1`, [first[0].id]);
      await expect(insertOffering(parents, { status: 'planned' })).resolves.toBeTruthy();
    });

    // Drift-guard (todo 266 item 7): assert EVERY non-terminal status participates in the index predicate,
    // so a future M05 status added to OFFERING_STATUSES but forgotten in the index WHERE-clause fails here.
    it.each(['planned', 'approved', 'opened', 'subscribed'])(
      "a prior offering in non-terminal status '%s' blocks a second active offering (23505)",
      async (status) => {
        const parents = await seedDeployedArtwork();
        await insertOffering(parents, { status });
        await expectPgError(
          () => insertOffering(parents, { status: 'planned' }),
          UNIQUE_VIOLATION,
          'UQ_offerings_active_per_artwork',
        );
      },
    );
  });

  describe('CHK_off_band (price band)', () => {
    it('rejects low >= high (23514)', async () => {
      const parents = await seedDeployedArtwork();
      // low == high
      await expectPgError(
        () => insertOffering(parents, { low: '100000000', high: '100000000' }),
        CHECK_VIOLATION,
        'CHK_off_band',
      );
      // low > high
      await expectPgError(
        () => insertOffering(parents, { low: '150000000', high: '50000000' }),
        CHECK_VIOLATION,
        'CHK_off_band',
      );
    });

    it('rejects a non-positive low bound (23514)', async () => {
      const parents = await seedDeployedArtwork();
      await expectPgError(
        () => insertOffering(parents, { low: '0', high: '150000000' }),
        CHECK_VIOLATION,
        'CHK_off_band',
      );
    });

    it('rejects a high bound over 2^96 - 1 (23514)', async () => {
      const parents = await seedDeployedArtwork();
      await expectPgError(
        () => insertOffering(parents, { low: '50000000', high: OVER_MAX_STROOPS }),
        CHECK_VIOLATION,
        'CHK_off_band',
      );
    });
  });

  describe('CHK_off_float (public float)', () => {
    it('rejects public_float = 0 (23514)', async () => {
      const parents = await seedDeployedArtwork();
      await expectPgError(
        () => insertOffering(parents, { publicFloat: '0' }),
        CHECK_VIOLATION,
        'CHK_off_float',
      );
    });
  });

  describe('CHK_off_window (subscription window)', () => {
    it('rejects window_close_at <= window_open_at (23514)', async () => {
      const parents = await seedDeployedArtwork();
      // close < open
      await expectPgError(
        () =>
          insertOffering(parents, {
            windowOpenAt: '2026-09-08T00:00:00Z',
            windowCloseAt: '2026-09-01T00:00:00Z',
          }),
        CHECK_VIOLATION,
        'CHK_off_window',
      );
      // close == open
      await expectPgError(
        () =>
          insertOffering(parents, {
            windowOpenAt: '2026-09-01T00:00:00Z',
            windowCloseAt: '2026-09-01T00:00:00Z',
          }),
        CHECK_VIOLATION,
        'CHK_off_window',
      );
    });
  });

  describe('foreign keys', () => {
    it('rejects an unknown artwork_id (23503)', async () => {
      const parents = await seedDeployedArtwork();
      // Both FK_offerings_artwork and the composite FK_offerings_artwork_fc reference artwork_id, so either
      // may surface — assert the SQLSTATE only (not a specific constraint name).
      await expectPgError(
        () => insertOffering(parents, { artworkId: '00000000-0000-4000-8000-0000000fdead' }),
        FK_VIOLATION,
      );
    });

    it('rejects an unknown fraction_contract_id via the composite FK (FK_offerings_artwork_fc, 23503)', async () => {
      const parents = await seedDeployedArtwork();
      await expectPgError(
        () => insertOffering(parents, { fractionContractId: '00000000-0000-4000-8000-0000000fbeef' }),
        FK_VIOLATION,
        'FK_offerings_artwork_fc',
      );
    });

    // todo 259: the composite FK hard-enforces that the referenced contract belongs to the referenced artwork.
    it('rejects a contract belonging to a DIFFERENT artwork (FK_offerings_artwork_fc, 23503)', async () => {
      const a = await seedDeployedArtwork();
      const b = await seedDeployedArtwork();
      await expectPgError(
        // artwork A + artwork B's contract — a cross-artwork mismatch that the old single-column FKs allowed.
        () => insertOffering({ artworkId: a.artworkId, fractionContractId: b.fractionContractId }),
        FK_VIOLATION,
        'FK_offerings_artwork_fc',
      );
    });
  });
});
