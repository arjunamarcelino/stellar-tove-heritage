import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Module } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createTestingModule, truncateTables } from '../../setup';
import { Artwork } from '@modules/fractionalization/entities/artwork.entity';
import { FractionContract } from '@modules/fractionalization/entities/fraction-contract.entity';
import { FractionContractRepository } from '@modules/fractionalization/repositories/fraction-contract.repository';
import { FRACTION_CONTRACT_REPOSITORY } from '@modules/fractionalization/repositories/fraction-contract-repository.interface';
import type { IFractionContractRepository } from '@modules/fractionalization/repositories/fraction-contract-repository.interface';
import { ArtworkRepository } from '@modules/fractionalization/repositories/artwork.repository';
import { ARTWORK_REPOSITORY } from '@modules/fractionalization/repositories/artwork-repository.interface';
import type { IArtworkRepository } from '@modules/fractionalization/repositories/artwork-repository.interface';
import { isUniqueConstraintError } from '@common/utils/database.utils';

/** NOTE: requires the local `tove_test` DB migrated (`yarn db:test:setup`). */
@Module({
  imports: [TypeOrmModule.forFeature([Artwork, FractionContract])],
  providers: [
    { provide: FRACTION_CONTRACT_REPOSITORY, useClass: FractionContractRepository },
    { provide: ARTWORK_REPOSITORY, useClass: ArtworkRepository },
  ],
})
class TestFractionModule {}

const UNIQUE_ACTIVE_INDEX = 'UQ_fraction_contracts_active_per_artwork';
const ARTIST = '00000000-0000-4000-8000-0000000f1001';

describe('FractionContract repository + schema integration', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let repo: IFractionContractRepository;
  let artworkRepo: IArtworkRepository;

  beforeAll(async () => {
    module = await createTestingModule(TestFractionModule);
    dataSource = module.get(DataSource);
    repo = module.get(FRACTION_CONTRACT_REPOSITORY);
    artworkRepo = module.get(ARTWORK_REPOSITORY);
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

  async function createArtwork(status = 'verified'): Promise<string> {
    const rows: { id: string }[] = await dataSource.query(
      `INSERT INTO artworks (status, artist_user_id, title) VALUES ($1, $2, 'A') RETURNING id`,
      [status, ARTIST],
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

  it('enforces one active contract per artwork (partial-unique index)', async () => {
    const artworkId = await createArtwork();
    await repo.save(repo.create(deployingRow(artworkId)));
    let hit = false;
    try {
      await repo.save(repo.create(deployingRow(artworkId)));
    } catch (err) {
      hit = isUniqueConstraintError(err, UNIQUE_ACTIVE_INDEX);
    }
    expect(hit).toBe(true);
  });

  it('allows a fresh deploying row after a failed one (failed excluded from the index)', async () => {
    const artworkId = await createArtwork();
    const first = await repo.save(repo.create(deployingRow(artworkId)));
    await dataSource.query(`UPDATE fraction_contracts SET status='failed' WHERE id=$1`, [first.id]);
    const second = await repo.save(repo.create(deployingRow(artworkId)));
    expect(second.id).not.toBe(first.id);
  });

  it('rejects soft-deleting a deployed row (CHK_fc_deployed_not_softdeleted)', async () => {
    const artworkId = await createArtwork();
    const row = await repo.save(repo.create(deployingRow(artworkId)));
    await dataSource.query(
      `UPDATE fraction_contracts SET status='deployed', token_address=$2 WHERE id=$1`,
      [row.id, 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'],
    );
    await expect(
      dataSource.query(`UPDATE fraction_contracts SET deleted_at=now() WHERE id=$1`, [row.id]),
    ).rejects.toBeTruthy();
  });

  it('casDeployed transitions deploying→deployed; findLatestByArtworkId includes failed', async () => {
    const artworkId = await createArtwork();
    const row = await repo.save(repo.create(deployingRow(artworkId)));
    await repo.runInTransaction((m) =>
      repo.casDeployed(m, row.id, {
        tokenAddress: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
        deployLedger: '1000',
        artistRetentionAmount: '100000',
        treasuryRetentionAmount: '50000',
      }),
    );
    const active = await repo.findActiveByArtworkId(artworkId);
    expect(active?.status).toBe('deployed');

    // A failed attempt is invisible to findActive but visible to findLatest.
    await dataSource.query(`UPDATE fraction_contracts SET status='failed' WHERE id=$1`, [row.id]);
    expect(await repo.findActiveByArtworkId(artworkId)).toBeNull();
    expect((await repo.findLatestByArtworkId(artworkId))?.status).toBe('failed');
  });

  it('findAllDeployed returns only deployed rows (excludes deploying/failed) — TOV-237', async () => {
    const [deployedArt, deployingArt, failedArt] = await Promise.all([
      createArtwork(),
      createArtwork(),
      createArtwork(),
    ]);
    // deployed
    const deployedRow = await repo.save(repo.create(deployingRow(deployedArt)));
    await dataSource.query(
      `UPDATE fraction_contracts SET status='deployed', token_address=$2 WHERE id=$1`,
      [deployedRow.id, 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'],
    );
    // deploying (left as-is)
    await repo.save(repo.create(deployingRow(deployingArt)));
    // failed
    const failedRow = await repo.save(repo.create(deployingRow(failedArt)));
    await dataSource.query(`UPDATE fraction_contracts SET status='failed' WHERE id=$1`, [failedRow.id]);

    const deployed = await repo.findAllDeployed();
    expect(deployed).toHaveLength(1);
    expect(deployed[0].id).toBe(deployedRow.id);
    expect(deployed[0].status).toBe('deployed');
  });

  it('ArtworkRepository.findByIds returns live rows only and [] for an empty input — TOV-237', async () => {
    const liveId = await createArtwork();
    const deletedId = await createArtwork();
    await dataSource.query(`UPDATE artworks SET deleted_at=now() WHERE id=$1`, [deletedId]);

    const found = await artworkRepo.findByIds([liveId, deletedId, ARTIST]);
    expect(found.map((a) => a.id)).toEqual([liveId]);
    expect(await artworkRepo.findByIds([])).toEqual([]);
  });
});
