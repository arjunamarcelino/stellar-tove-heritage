import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { ProfileImage } from '@modules/users/profile/entities/profile-image.entity';
import { ProfileImageRepository } from '@modules/users/profile/repositories/profile-image.repository';
import {
  PROFILE_IMAGE_REPOSITORY,
  IProfileImageRepository,
} from '@modules/users/profile/repositories/profile-image-repository.interface';
import { ProfileImageReaperService } from '@modules/users/profile/maintenance/profile-image-reaper.service';
import { ProfileImageReconcileService } from '@modules/users/profile/maintenance/profile-image-reconcile.service';
import { ProfileErasureService } from '@modules/users/profile/profile-erasure.service';
import { profilePublicDerivativePath } from '@modules/users/profile/constants/profile-image.constants';
import {
  PROFILE_SOURCE_STORAGE,
  PROFILE_PUBLIC_STORAGE,
  profileSourcePath,
} from '@modules/users/profile/constants/profile-image.constants';
import { FakeProfileStorage } from '../../../../shared/fake-profile-storage';
import { createTestingModule, truncateTables } from '../../../setup';

const source = new FakeProfileStorage();
const pub = new FakeProfileStorage();

@Module({
  imports: [TypeOrmModule.forFeature([ProfileImage])],
  providers: [
    { provide: PROFILE_IMAGE_REPOSITORY, useClass: ProfileImageRepository },
    { provide: PROFILE_SOURCE_STORAGE, useValue: source },
    { provide: PROFILE_PUBLIC_STORAGE, useValue: pub },
    ProfileImageReaperService,
  ],
})
class TestMaintenanceModule {}

const USER = '11111111-1111-1111-1111-111111111111';

async function seedImage(
  ds: DataSource,
  id: string,
  status: string,
  createdAt: string,
  deleted = false,
): Promise<void> {
  await ds.query(
    `INSERT INTO profile_images (id, user_id, status, source_path, created_at, updated_at, deleted_at)
     VALUES ($1,$2,$3,$4,$5,$5,$6)`,
    [id, USER, status, profileSourcePath(USER, id), createdAt, deleted ? createdAt : null],
  );
}

describe('profile image maintenance (integration, TOV-30)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let images: IProfileImageRepository;
  let reaper: ProfileImageReaperService;
  let reconcile: ProfileImageReconcileService;
  const added: { name: string; data: unknown }[] = [];

  beforeAll(async () => {
    module = await createTestingModule(TestMaintenanceModule);
    ds = module.get(DataSource);
    images = module.get<IProfileImageRepository>(PROFILE_IMAGE_REPOSITORY);
    reaper = module.get(ProfileImageReaperService);
    // Reconcile needs the derivative queue — a capturing fake is enough here.
    reconcile = new ProfileImageReconcileService(images, {
      add: (name: string, data: unknown) => {
        added.push({ name, data });
        return Promise.resolve(undefined);
      },
    } as never);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await truncateTables(ds);
    source.clear();
    pub.clear();
    added.length = 0;
    await ds.query(`INSERT INTO users (id) VALUES ($1)`, [USER]);
  });

  it('reaps stale pending/failed and soft-deleted rows, keeps recent ready rows', async () => {
    const old = '2000-01-01T00:00:00Z';
    const now = new Date().toISOString();
    const stalePending = '22222222-0000-0000-0000-000000000001';
    const staleFailed = '22222222-0000-0000-0000-000000000002';
    const softDeleted = '22222222-0000-0000-0000-000000000003';
    const freshReady = '22222222-0000-0000-0000-000000000004';
    await seedImage(ds, stalePending, 'pending', old);
    await seedImage(ds, staleFailed, 'failed', old);
    await seedImage(ds, softDeleted, 'ready', now, true);
    await seedImage(ds, freshReady, 'ready', now);
    for (const id of [stalePending, staleFailed, softDeleted, freshReady]) {
      source.putDirect(profileSourcePath(USER, id), Buffer.from('x'));
    }

    const { reaped } = await reaper.reap();
    expect(reaped).toBe(3);
    expect(source.has(profileSourcePath(USER, stalePending))).toBe(false);
    expect(source.has(profileSourcePath(USER, softDeleted))).toBe(false);
    expect(source.has(profileSourcePath(USER, freshReady))).toBe(true);
    // fresh ready row survives
    expect(await images.findById(freshReady)).not.toBeNull();
  });

  it('never reaps a row still referenced as the active avatar (belt guard)', async () => {
    const old = '2000-01-01T00:00:00Z';
    const referenced = '22222222-0000-0000-0000-00000000000a';
    await seedImage(ds, referenced, 'failed', old); // stale + failed → would normally be reapable
    await ds.query(`UPDATE users SET profile_image_id = $1 WHERE id = $2`, [referenced, USER]);
    source.putDirect(profileSourcePath(USER, referenced), Buffer.from('x'));

    const { reaped } = await reaper.reap();
    expect(reaped).toBe(0);
    expect(await images.findById(referenced)).not.toBeNull();
    expect(source.has(profileSourcePath(USER, referenced))).toBe(true);
  });

  it('re-drives a stuck processing row with a unique jobId', async () => {
    const stuck = '33333333-0000-0000-0000-000000000001';
    // created/updated 20 min ago (past the 10-min re-drive threshold, under the 60-min fail threshold)
    const twentyMinAgo = new Date(Date.now() - 20 * 60_000).toISOString();
    await seedImage(ds, stuck, 'processing', twentyMinAgo);

    const { redriven, failed } = await reconcile.reconcile();
    expect(redriven).toBe(1);
    expect(failed).toBe(0);
    expect(added[0]?.name).toBe('derive');
  });

  it('erases a deleted user’s profile images (public unpublished, rows soft-deleted, then reaped)', async () => {
    const erasure = new ProfileErasureService(images, pub);
    const now = new Date().toISOString();
    const active = '44444444-0000-0000-0000-000000000001';
    await seedImage(ds, active, 'ready', now);
    await ds.query(`UPDATE users SET profile_image_id = $1 WHERE id = $2`, [active, USER]);
    pub.putDirect(profilePublicDerivativePath(active, 512), Buffer.from('h'));
    source.putDirect(profileSourcePath(USER, active), Buffer.from('s'));

    // simulate the account being soft-deleted, then erase
    await ds.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [USER]);
    await erasure.purgeForUser(USER);

    expect(pub.has(profilePublicDerivativePath(active, 512))).toBe(false); // public unpublished
    expect(await images.findOwned(active, USER)).toBeNull(); // row soft-deleted
    // reaper reclaims the private source (the deleted user's FK no longer protects it)
    const { reaped } = await reaper.reap();
    expect(reaped).toBe(1);
    expect(source.has(profileSourcePath(USER, active))).toBe(false);
  });

  it('fails a hard-stuck processing row past the fail threshold', async () => {
    const dead = '33333333-0000-0000-0000-000000000002';
    const old = '2000-01-01T00:00:00Z';
    await seedImage(ds, dead, 'processing', old);

    const { failed } = await reconcile.reconcile();
    expect(failed).toBe(1);
    expect((await images.findById(dead))?.status).toBe('failed');
  });
});
