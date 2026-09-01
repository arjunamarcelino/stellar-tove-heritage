import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Module } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { createTestingModule, truncateTables } from '../../setup';
import { Artwork } from '@modules/fractionalization/entities/artwork.entity';
import { FractionContract } from '@modules/fractionalization/entities/fraction-contract.entity';
import { FractionContractRepository } from '@modules/fractionalization/repositories/fraction-contract.repository';
import { ArtworkRepository } from '@modules/fractionalization/repositories/artwork.repository';
import { FRACTION_CONTRACT_REPOSITORY } from '@modules/fractionalization/repositories/fraction-contract-repository.interface';
import type { IFractionContractRepository } from '@modules/fractionalization/repositories/fraction-contract-repository.interface';
import { ARTWORK_REPOSITORY } from '@modules/fractionalization/repositories/artwork-repository.interface';
import type { IArtworkRepository } from '@modules/fractionalization/repositories/artwork-repository.interface';
import { ARTWORK_STATUSES } from '@modules/fractionalization/constants/artwork-status.constant';

/** NOTE: requires the local `tove_test` DB migrated (`yarn db:test:setup`). */
@Module({
  imports: [TypeOrmModule.forFeature([Artwork, FractionContract])],
  providers: [
    { provide: FRACTION_CONTRACT_REPOSITORY, useClass: FractionContractRepository },
    { provide: ARTWORK_REPOSITORY, useClass: ArtworkRepository },
  ],
})
class TestReadModule {}

const ARTIST = '00000000-0000-4000-8000-0000000f2001';

describe('Backoffice artworks read repositories (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let contracts: IFractionContractRepository;
  let artworks: IArtworkRepository;

  beforeAll(async () => {
    module = await createTestingModule(TestReadModule);
    dataSource = module.get(DataSource);
    contracts = module.get(FRACTION_CONTRACT_REPOSITORY);
    artworks = module.get(ARTWORK_REPOSITORY);
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
    await dataSource.query(
      `INSERT INTO users (id, is_active, kyc_status) VALUES ($1, true, 'not_submitted') ON CONFLICT DO NOTHING`,
      [ARTIST],
    );
  });

  async function createArtwork(status = 'verified', title = 'A'): Promise<string> {
    const rows: { id: string }[] = await dataSource.query(
      `INSERT INTO artworks (status, artist_user_id, title) VALUES ($1, $2, $3) RETURNING id`,
      [status, ARTIST, title],
    );
    return rows[0].id;
  }

  const deployingRow = (artworkId: string): Partial<FractionContract> => ({
    artworkId,
    status: 'deploying',
    wasmHash: '7ad8c08d6e4d72dafba21c1b27b8908e974d725a46aa354491185ae6f26947cd',
    tokenName: 'A',
    tokenSymbol: 'AAA',
    artistAddress: 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O',
    totalSupply: '1000000',
    artistRetentionPct: 10,
    treasuryRetentionPct: 5,
    artistLockupDays: 365,
    treasuryLockupDays: 730,
  });

  describe('findActiveByArtworkIds', () => {
    it('returns only active (deploying|deployed) rows; excludes failed-only and none', async () => {
      const a = await createArtwork(); // → deployed
      const b = await createArtwork(); // → deploying
      const c = await createArtwork(); // → failed only
      const d = await createArtwork(); // → no contract

      const aRow = await contracts.save(contracts.create(deployingRow(a)));
      await dataSource.query(
        `UPDATE fraction_contracts SET status='deployed', token_address=$2 WHERE id=$1`,
        [aRow.id, 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'],
      );
      await contracts.save(contracts.create(deployingRow(b)));
      const cRow = await contracts.save(contracts.create(deployingRow(c)));
      await dataSource.query(`UPDATE fraction_contracts SET status='failed' WHERE id=$1`, [cRow.id]);

      const found = await contracts.findActiveByArtworkIds([a, b, c, d]);
      const byArtwork = new Map(found.map((f) => [f.artworkId, f.status]));

      expect(byArtwork.get(a)).toBe('deployed');
      expect(byArtwork.get(b)).toBe('deploying');
      expect(byArtwork.has(c)).toBe(false);
      expect(byArtwork.has(d)).toBe(false);
    });

    it('short-circuits an empty id list to [] (no SQL)', async () => {
      expect(await contracts.findActiveByArtworkIds([])).toEqual([]);
    });
  });

  describe('status tuple ↔ DB CHECK constraint parity (drift guard)', () => {
    // The DTOs echo `status` verbatim and validators/enums derive from the TS tuples; if a migration
    // widens a CHECK without updating the tuple (or vice-versa), the API silently emits/accepts a value
    // outside its declared enum. These assert the tuple equals the DB CHECK set.
    async function checkConstraintValues(constraint: string): Promise<string[]> {
      const rows: { def: string }[] = await dataSource.query(
        `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.conname = $1`,
        [constraint],
      );
      const def = rows[0]?.def ?? '';
      return (def.match(/'([^']+)'::/g) ?? []).map((m) => m.slice(1, -3)).sort();
    }

    it('CHK_artworks_status matches ARTWORK_STATUSES', async () => {
      expect(await checkConstraintValues('CHK_artworks_status')).toEqual([...ARTWORK_STATUSES].sort());
    });

    it('CHK_fc_status matches the fraction contract status union', async () => {
      expect(await checkConstraintValues('CHK_fc_status')).toEqual(['deployed', 'deploying', 'failed']);
    });
  });

  describe('artwork paginated finder', () => {
    it('filters by status IN, orders createdAt DESC, and excludes soft-deleted rows', async () => {
      const v1 = await createArtwork('verified', 'first');
      await new Promise((r) => setTimeout(r, 5));
      const v2 = await createArtwork('verified', 'second');
      await createArtwork('published', 'pub'); // excluded by filter
      const del = await createArtwork('verified', 'deleted');
      await dataSource.query(`UPDATE artworks SET deleted_at = now() WHERE id = $1`, [del]);

      const [rows, total] = await artworks.findWithPagination(
        { where: { status: In(['verified', 'fractionalizing', 'fractionalized']) }, order: { createdAt: 'DESC' } },
        1,
        10,
      );

      const ids = rows.map((r) => r.id);
      expect(total).toBe(2); // v1, v2 — published filtered, deleted excluded
      expect(ids).toEqual([v2, v1]); // newest first
      expect(ids).not.toContain(del);
    });
  });
});
