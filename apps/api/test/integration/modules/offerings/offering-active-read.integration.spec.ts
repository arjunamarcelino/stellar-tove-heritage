import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestingModule, truncateTables } from '../../setup';
import { insertOffering as sharedInsertOffering } from '../../../shared/seed-offering';
import { OfferingsModule } from '@modules/offerings/offerings.module';
import {
  OFFERING_REPOSITORY,
  IOfferingRepository,
} from '@modules/offerings/repositories/offering-repository.interface';
import { ACTIVE_OFFERING_STATUSES } from '@modules/offerings/constants/offering-status.constant';

/**
 * Integration cover for TOV-153's `OfferingRepository.findActiveByArtworkId` (the artwork-detail
 * `activeOffering` embed) against the pre-migrated `tove_test` DB, plus the drift guard that keeps the
 * TS `ACTIVE_OFFERING_STATUSES` constant in lockstep with the `UQ_offerings_active_per_artwork` index
 * predicate. NB: the predicate is a partial UNIQUE INDEX (`CREATE UNIQUE INDEX … WHERE`), so it is read
 * from `pg_indexes` — NOT `pg_constraint`, which would return zero rows and silently pass.
 *
 * Requires the local `tove_test` DB migrated (`yarn db:test:setup`).
 */
describe('OfferingRepository.findActiveByArtworkId + active-status drift guard (integration)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let repo: IOfferingRepository;

  beforeAll(async () => {
    moduleRef = await createTestingModule(OfferingsModule);
    ds = moduleRef.get(DataSource);
    repo = moduleRef.get<IOfferingRepository>(OFFERING_REPOSITORY);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
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

  async function insertOffering(
    parents: { artworkId: string; fractionContractId: string },
    status = 'planned',
  ): Promise<{ id: string }[]> {
    // TOV-154 CHK_off_approved_has_escrow: post-approval statuses must carry an escrow address.
    const escrowAddress = ['approved', 'opened', 'subscribed', 'settled'].includes(status)
      ? 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
      : null;
    // Delegates to the shared seeder; wraps in `[{ id }]` to preserve this file's array-return contract.
    const id = await sharedInsertOffering(q, {
      artworkId: parents.artworkId,
      fractionContractId: parents.fractionContractId,
      status,
      windowOpenAt: '2026-09-01T00:00:00Z',
      windowCloseAt: '2026-09-08T00:00:00Z',
      createdByAdminSub: ADMIN_SUB,
      escrowContractAddress: escrowAddress,
    });
    return [{ id }];
  }

  it('returns the single planned offering for an artwork (positive)', async () => {
    const parents = await seedDeployedArtwork();
    const inserted = await insertOffering(parents, 'planned');
    const found = await repo.findActiveByArtworkId(parents.artworkId);
    expect(found?.id).toBe(inserted[0].id);
    expect(found?.status).toBe('planned');
  });

  it.each([...ACTIVE_OFFERING_STATUSES])(
    "finds an offering in non-terminal status '%s' (edge)",
    async (status) => {
      const parents = await seedDeployedArtwork();
      await insertOffering(parents, status);
      const found = await repo.findActiveByArtworkId(parents.artworkId);
      expect(found?.status).toBe(status);
    },
  );

  it.each(['settled', 'canceled'])(
    "returns null for terminal status '%s' (negative)",
    async (status) => {
      const parents = await seedDeployedArtwork();
      await insertOffering(parents, status);
      expect(await repo.findActiveByArtworkId(parents.artworkId)).toBeNull();
    },
  );

  it('returns null when the artwork has no offering (negative)', async () => {
    const parents = await seedDeployedArtwork();
    expect(await repo.findActiveByArtworkId(parents.artworkId)).toBeNull();
  });

  it('ignores a soft-deleted active offering (deleted_at IS NULL predicate) (edge)', async () => {
    const parents = await seedDeployedArtwork();
    const inserted = await insertOffering(parents, 'planned');
    await q(`UPDATE offerings SET deleted_at = now() WHERE id = $1`, [inserted[0].id]);
    expect(await repo.findActiveByArtworkId(parents.artworkId)).toBeNull();
  });

  // Drift guard: read the index def from pg_indexes (NOT pg_constraint — this is a partial UNIQUE INDEX).
  // The only single-quoted literals in the predicate are the four statuses, so extracting them and
  // comparing the set proves the TS constant tracks the SQL predicate; also assert deleted_at IS NULL.
  it('ACTIVE_OFFERING_STATUSES matches the UQ_offerings_active_per_artwork index predicate', async () => {
    const rows = await q<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'UQ_offerings_active_per_artwork'`,
    );
    expect(rows).toHaveLength(1);
    const def = rows[0].indexdef;

    const literals = [...def.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    const indexStatuses = [...new Set(literals)].sort();
    expect(indexStatuses).toEqual([...ACTIVE_OFFERING_STATUSES].sort());
    expect(def).toMatch(/deleted_at IS NULL/i);
  });
});
