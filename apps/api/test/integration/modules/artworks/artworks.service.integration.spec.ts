import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Module } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createTestingModule, truncateTables } from '../../setup';
import { Artwork } from '@modules/fractionalization/entities/artwork.entity';
import { ArtworkImage } from '@modules/fractionalization/entities/artwork-image.entity';
import { ArtworkReadRepository } from '@modules/artworks/repositories/artwork-read.repository';
import {
  ARTWORK_READ_REPOSITORY,
  type IArtworkReadRepository,
} from '@modules/artworks/repositories/artwork-read-repository.interface';
import { insertArtwork, insertArtworkArtist } from '../../../shared/seed-artwork';

/** NOTE: requires the local `tove_test` DB migrated (`yarn db:test:setup`). */
@Module({
  imports: [TypeOrmModule.forFeature([Artwork, ArtworkImage])],
  providers: [{ provide: ARTWORK_READ_REPOSITORY, useClass: ArtworkReadRepository }],
})
class TestReadModule {}

const ARTIST = '00000000-0000-4000-8000-0000000f1890';

describe('ArtworkReadRepository (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let repo: IArtworkReadRepository;
  const q = (text: string, params?: unknown[]) => dataSource.query(text, params);

  beforeAll(async () => {
    module = await createTestingModule(TestReadModule);
    dataSource = module.get(DataSource);
    repo = module.get(ARTWORK_READ_REPOSITORY);
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
    await insertArtworkArtist(q, ARTIST);
  });

  describe('findAll — visibility + ordering', () => {
    it('returns only verified + fractionalized, excludes published/fractionalizing/soft-deleted', async () => {
      await insertArtwork(q, { artistUserId: ARTIST, status: 'verified', title: 'v' });
      await insertArtwork(q, { artistUserId: ARTIST, status: 'fractionalized', title: 'f' });
      await insertArtwork(q, { artistUserId: ARTIST, status: 'published', title: 'p' });
      await insertArtwork(q, { artistUserId: ARTIST, status: 'fractionalizing', title: 'ing' });
      const del = await insertArtwork(q, { artistUserId: ARTIST, status: 'verified', title: 'deleted' });
      await q(`UPDATE artworks SET deleted_at = now() WHERE id = $1`, [del]);

      const rows = await repo.findAll(50);
      const titles = rows.map((r) => r.title).sort();
      expect(titles).toEqual(['f', 'v']);
    });

    it('orders by created_at DESC, id ASC', async () => {
      const a = await insertArtwork(q, { artistUserId: ARTIST, status: 'verified', title: 'older' });
      await new Promise((r) => setTimeout(r, 5));
      const b = await insertArtwork(q, { artistUserId: ARTIST, status: 'verified', title: 'newer' });

      const rows = await repo.findAll(50);
      expect(rows.map((r) => r.id)).toEqual([b, a]);
    });
  });

  describe('findOneById — detail projection', () => {
    it('returns supporting images ordered by sort_order (seeded out of order) + custodian + coa path', async () => {
      const id = await insertArtwork(q, {
        artistUserId: ARTIST,
        status: 'verified',
        custodian: 'Tove Vault, Oslo',
        coaStoragePath: 'coa/aw.pdf',
        supportingImages: [
          { storagePath: 'img/c.jpg', sortOrder: 2 },
          { storagePath: 'img/a.jpg', sortOrder: 0 },
          { storagePath: 'img/b.jpg', sortOrder: 1 },
        ],
      });

      const record = await repo.findOneById(id);
      expect(record).not.toBeNull();
      expect(record?.custodian).toBe('Tove Vault, Oslo');
      expect(record?.coaStoragePath).toBe('coa/aw.pdf');
      expect(record?.supportingImages).toEqual(['img/a.jpg', 'img/b.jpg', 'img/c.jpg']);
    });

    it('excludes soft-deleted supporting images', async () => {
      const id = await insertArtwork(q, {
        artistUserId: ARTIST,
        status: 'fractionalized',
        supportingImages: [
          { storagePath: 'img/keep.jpg', sortOrder: 0 },
          { storagePath: 'img/gone.jpg', sortOrder: 1 },
        ],
      });
      await q(`UPDATE artwork_images SET deleted_at = now() WHERE storage_path = $1`, ['img/gone.jpg']);

      const record = await repo.findOneById(id);
      expect(record?.supportingImages).toEqual(['img/keep.jpg']);
    });

    it('returns null for a published artwork (not publicly visible)', async () => {
      const id = await insertArtwork(q, { artistUserId: ARTIST, status: 'published' });
      expect(await repo.findOneById(id)).toBeNull();
    });

    it('returns null for a soft-deleted artwork', async () => {
      const id = await insertArtwork(q, { artistUserId: ARTIST, status: 'verified' });
      await q(`UPDATE artworks SET deleted_at = now() WHERE id = $1`, [id]);
      expect(await repo.findOneById(id)).toBeNull();
    });

    it('returns null for an unknown UUID', async () => {
      expect(await repo.findOneById('00000000-0000-4000-8000-0000000aaaaa')).toBeNull();
    });

    it('returns [] supportingImages when none exist', async () => {
      const id = await insertArtwork(q, { artistUserId: ARTIST, status: 'verified' });
      const record = await repo.findOneById(id);
      expect(record?.supportingImages).toEqual([]);
    });
  });
});
