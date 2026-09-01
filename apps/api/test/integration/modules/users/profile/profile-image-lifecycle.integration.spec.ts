import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { User } from '@modules/users/entities/user.entity';
import { HandleHistory } from '@modules/users/entities/handle-history.entity';
import { UserRepository } from '@modules/users/repositories/user.repository';
import { USER_REPOSITORY } from '@modules/users/repositories/user-repository.interface';
import { HandleHistoryRepository } from '@modules/users/repositories/handle-history.repository';
import { HANDLE_HISTORY_REPOSITORY } from '@modules/users/repositories/handle-history-repository.interface';
import { UsersService } from '@modules/users/users.service';
import { ProfileImage } from '@modules/users/profile/entities/profile-image.entity';
import { ProfileImageRepository } from '@modules/users/profile/repositories/profile-image.repository';
import {
  PROFILE_IMAGE_REPOSITORY,
  IProfileImageRepository,
} from '@modules/users/profile/repositories/profile-image-repository.interface';
import { ProfileService } from '@modules/users/profile/profile.service';
import { ProfileViewService } from '@modules/users/profile/profile-view.service';
import { ProfileDerivativeService } from '@modules/users/profile/derivatives/profile-derivative.service';
import { IdempotencyStore } from '@common/idempotency/idempotency-store';
import { profileImageConfig } from '@config/profile-image.config';
import {
  PROFILE_SOURCE_STORAGE,
  PROFILE_PUBLIC_STORAGE,
  PROFILE_DERIVATIVE_QUEUE,
  profileSourcePath,
  profilePublicDerivativePath,
} from '@modules/users/profile/constants/profile-image.constants';
import { PROFILE_PUBLIC_URL } from '@modules/users/profile/storage/profile-public-url.service';
import { FakeProfileStorage } from '../../../../shared/fake-profile-storage';
import { makeJpeg, notAnImage } from '../../../../shared/fixtures/images';
import { createTestingModule, truncateTables } from '../../../setup';

const source = new FakeProfileStorage();
const pub = new FakeProfileStorage();
const fakeIdem = {
  begin: () => Promise.resolve({ outcome: 'proceed' as const, token: 't' }),
  complete: () => Promise.resolve(),
  fail: () => Promise.resolve(),
};
const fakeQueue = { add: () => Promise.resolve(undefined) };

@Module({
  imports: [TypeOrmModule.forFeature([User, ProfileImage, HandleHistory])],
  providers: [
    { provide: USER_REPOSITORY, useClass: UserRepository },
    { provide: HANDLE_HISTORY_REPOSITORY, useClass: HandleHistoryRepository },
    { provide: PROFILE_IMAGE_REPOSITORY, useClass: ProfileImageRepository },
    { provide: PROFILE_SOURCE_STORAGE, useValue: source },
    { provide: PROFILE_PUBLIC_STORAGE, useValue: pub },
    { provide: PROFILE_PUBLIC_URL, useValue: { getPublicUrl: (p: string) => `https://fake-cdn.test/public/${p}` } },
    { provide: IdempotencyStore, useValue: fakeIdem },
    { provide: getQueueToken(PROFILE_DERIVATIVE_QUEUE), useValue: fakeQueue },
    { provide: profileImageConfig.KEY, useValue: { maxBytes: 5_242_880 } },
    UsersService,
    ProfileViewService,
    ProfileService,
  ],
})
class TestProfileModule {}

const USER = '11111111-1111-1111-1111-111111111111';

describe('profile image lifecycle (integration, TOV-30)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: ProfileService;
  let view: ProfileViewService;
  let images: IProfileImageRepository;
  let derive: ProfileDerivativeService;

  beforeAll(async () => {
    module = await createTestingModule(TestProfileModule);
    dataSource = module.get(DataSource);
    service = module.get(ProfileService);
    view = module.get(ProfileViewService);
    images = module.get<IProfileImageRepository>(PROFILE_IMAGE_REPOSITORY);
    derive = new ProfileDerivativeService(images, source);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
    source.clear();
    pub.clear();
    await dataSource.query(`INSERT INTO users (id, handle) VALUES ($1, 'collector')`, [USER]);
  });

  it('PATCH persists profile fields and clears on null', async () => {
    await service.updateProfile(USER, { bio: 'hello', statement: 'stmt' });
    let row = await dataSource.getRepository(User).findOneByOrFail({ id: USER });
    expect(row.bio).toBe('hello');
    expect(row.statement).toBe('stmt');

    await service.updateProfile(USER, { bio: null });
    row = await dataSource.getRepository(User).findOneByOrFail({ id: USER });
    expect(row.bio).toBeNull();
    expect(row.statement).toBe('stmt'); // untouched by the disjoint update
  });

  it('runs the full upload → commit → derive → activate → GET flow', async () => {
    const { profileImageId } = await service.requestUpload(USER, 'k1');
    // simulate the client's direct PUT to the signed URL
    source.putDirect(profileSourcePath(USER, profileImageId), await makeJpeg());

    const commit = await service.commitUpload(USER, profileImageId, 'k2');
    expect(commit.status).toBe('processing');

    await derive.generate(profileImageId);
    const ready = await images.findOwned(profileImageId, USER);
    expect(ready?.status).toBe('ready');
    expect(Object.keys(ready?.derivatives ?? {}).sort()).toEqual(['card', 'hero', 'thumb']);

    // GET before activation: no public avatar
    expect((await view.buildForUser(USER)).profileImage).toBeNull();

    await service.updateProfile(USER, { profileImageId });
    const profile = await view.buildForUser(USER);
    expect(profile.profileImage).not.toBeNull();
    expect(profile.profileImage?.heroUrl).toContain(profilePublicDerivativePath(profileImageId, 512));
    expect(pub.has(profilePublicDerivativePath(profileImageId, 512))).toBe(true);
  });

  it('replacing the avatar deletes the prior public copies; DELETE purges everything', async () => {
    // first avatar, activated
    const a = (await service.requestUpload(USER, 'a1')).profileImageId;
    source.putDirect(profileSourcePath(USER, a), await makeJpeg());
    await service.commitUpload(USER, a, 'a2');
    await derive.generate(a);
    await service.updateProfile(USER, { profileImageId: a });
    expect(pub.has(profilePublicDerivativePath(a, 512))).toBe(true);

    // second avatar, activated → first one's public copies gone
    const b = (await service.requestUpload(USER, 'b1')).profileImageId;
    source.putDirect(profileSourcePath(USER, b), await makeJpeg());
    await service.commitUpload(USER, b, 'b2');
    await derive.generate(b);
    await service.updateProfile(USER, { profileImageId: b });
    expect(pub.has(profilePublicDerivativePath(a, 512))).toBe(false);
    expect(pub.has(profilePublicDerivativePath(b, 512))).toBe(true);
    // prior image is fully retired: private source purged + row soft-deleted (bounds storage growth)
    expect(source.has(profileSourcePath(USER, a))).toBe(false);
    expect(await images.findOwned(a, USER)).toBeNull();

    // DELETE the active avatar → FK cleared, public + private purged
    await service.deleteImage(USER, b);
    expect(pub.has(profilePublicDerivativePath(b, 512))).toBe(false);
    expect(source.has(profileSourcePath(USER, b))).toBe(false);
    const row = await dataSource.getRepository(User).findOneByOrFail({ id: USER });
    expect(row.profileImageId).toBeNull();
  });

  it('marks failed and blocks activation for a non-image', async () => {
    const id = (await service.requestUpload(USER, 'c1')).profileImageId;
    source.putDirect(profileSourcePath(USER, id), notAnImage());
    await expect(service.commitUpload(USER, id, 'c2')).rejects.toMatchObject({
      status: 422,
      response: { errorCode: 'PROFILE_IMAGE_INVALID' },
    });
    const row = await images.findOwned(id, USER);
    expect(row?.status).toBe('failed');
    await expect(service.updateProfile(USER, { profileImageId: id })).rejects.toMatchObject({
      status: 422,
      response: { errorCode: 'PROFILE_IMAGE_NOT_READY' },
    });
  });
});
