import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProfileService } from '@modules/users/profile/profile.service';
import { IUserRepository } from '@modules/users/repositories/user-repository.interface';
import { IProfileImageRepository } from '@modules/users/profile/repositories/profile-image-repository.interface';
import { IdempotencyStore } from '@common/idempotency/idempotency-store';
import { ProfileViewService } from '@modules/users/profile/profile-view.service';
import { ProfileImage } from '@modules/users/profile/entities/profile-image.entity';
import { MeProfileResponseDto } from '@modules/users/profile/dto/me-profile-response.dto';
import { UserProfileFields } from '@modules/users/profile/profile.types';
import { profileSourcePath } from '@modules/users/profile/constants/profile-image.constants';
import { FakeProfileStorage } from '../../../../shared/fake-profile-storage';
import { makeJpeg } from '../../../../shared/fixtures/images';

const USER = '11111111-1111-1111-1111-111111111111';
const IMAGE = '22222222-2222-2222-2222-222222222222';

function fields(over: Partial<UserProfileFields> = {}): UserProfileFields {
  return {
    id: USER,
    email: 'c@test.io',
    handle: 'collector',
    bio: null,
    statement: null,
    socialLinks: null,
    profileImageId: null,
    ...over,
  };
}

function readyRow(): ProfileImage {
  const row = new ProfileImage();
  row.id = IMAGE;
  row.userId = USER;
  row.status = 'ready';
  row.sourcePath = profileSourcePath(USER, IMAGE);
  row.derivatives = { thumb: 'a', card: 'b', hero: 'c' };
  return row;
}

describe('ProfileService (TOV-30)', () => {
  let users: Record<string, ReturnType<typeof vi.fn>>;
  let images: Record<string, ReturnType<typeof vi.fn>>;
  let source: FakeProfileStorage;
  let pub: FakeProfileStorage;
  let idem: { begin: ReturnType<typeof vi.fn>; complete: ReturnType<typeof vi.fn>; fail: ReturnType<typeof vi.fn> };
  let queue: { add: ReturnType<typeof vi.fn> };
  let view: { buildForUser: ReturnType<typeof vi.fn> };
  let service: ProfileService;

  beforeEach(() => {
    users = {
      findProfileFieldsByUserId: vi.fn().mockResolvedValue(fields()),
      updateProfileFields: vi.fn().mockResolvedValue(true),
      activateAvatar: vi.fn().mockResolvedValue(true),
    };
    images = {
      findOwned: vi.fn(),
      countNonTerminalByUser: vi.fn().mockResolvedValue(0),
      createPending: vi.fn().mockResolvedValue(undefined),
      claimForProcessing: vi.fn().mockResolvedValue(true),
      markFailed: vi.fn(),
      softDeleteOwned: vi.fn().mockResolvedValue(true),
    };
    source = new FakeProfileStorage();
    pub = new FakeProfileStorage();
    idem = {
      begin: vi.fn().mockResolvedValue({ outcome: 'proceed', token: 'tok' }),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    queue = { add: vi.fn().mockResolvedValue(undefined) };
    view = { buildForUser: vi.fn().mockResolvedValue(new MeProfileResponseDto()) };
    service = new ProfileService(
      users as unknown as IUserRepository,
      images as unknown as IProfileImageRepository,
      source,
      pub,
      idem as unknown as IdempotencyStore,
      queue as never,
      { maxBytes: 5_242_880 } as never,
      view as unknown as ProfileViewService,
    );
  });

  describe('updateProfile', () => {
    it('throws 422 VALIDATION_FAILED naming the field on a bad bio', async () => {
      await expect(service.updateProfile(USER, { bio: 'a'.repeat(301) })).rejects.toMatchObject({
        status: 422,
        response: { errorCode: 'VALIDATION_FAILED', errors: [expect.objectContaining({ field: 'bio' })] },
      });
      expect(users.updateProfileFields).not.toHaveBeenCalled();
    });

    it('clears a field on explicit null', async () => {
      await service.updateProfile(USER, { bio: null });
      expect(users.updateProfileFields).toHaveBeenCalledWith(USER, { bio: null });
    });

    it('rejects activating a not-ready image (422) and an unknown image (404)', async () => {
      images.findOwned.mockResolvedValueOnce({ ...readyRow(), status: 'processing' });
      await expect(service.updateProfile(USER, { profileImageId: IMAGE })).rejects.toMatchObject({
        status: 422,
        response: { errorCode: 'PROFILE_IMAGE_NOT_READY' },
      });

      images.findOwned.mockResolvedValueOnce(null);
      await expect(service.updateProfile(USER, { profileImageId: IMAGE })).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'PROFILE_IMAGE_NOT_FOUND' },
      });
    });

    it('publishes derivatives to the public bucket on activation', async () => {
      images.findOwned.mockResolvedValue(readyRow());
      // seed the private derivatives the activation copies from
      source.putDirect('deriv/' + IMAGE + '/64.webp', Buffer.from('t'));
      source.putDirect('deriv/' + IMAGE + '/256.webp', Buffer.from('c'));
      source.putDirect('deriv/' + IMAGE + '/512.webp', Buffer.from('h'));

      await service.updateProfile(USER, { profileImageId: IMAGE });

      expect(pub.has('profile/' + IMAGE + '/64.webp')).toBe(true);
      expect(pub.has('profile/' + IMAGE + '/512.webp')).toBe(true);
      // Activation goes through the guarded conditional set, not the column-scoped field write.
      expect(users.activateAvatar).toHaveBeenCalledWith(USER, IMAGE);
    });
  });

  describe('commitUpload', () => {
    beforeEach(() => {
      images.findOwned.mockResolvedValue({
        ...readyRow(),
        status: 'pending',
      });
    });

    it('processes a valid image: probe ok → claim → enqueue', async () => {
      source.putDirect(profileSourcePath(USER, IMAGE), await makeJpeg());
      const res = await service.commitUpload(USER, IMAGE, 'key-1');
      expect(res).toEqual({ profileImageId: IMAGE, status: 'processing' });
      expect(images.claimForProcessing).toHaveBeenCalledWith(IMAGE, USER);
      expect(queue.add).toHaveBeenCalledWith(
        'derive',
        { profileImageId: IMAGE },
        expect.objectContaining({ jobId: `derive-${IMAGE}` }),
      );
    });

    it('returns 409 when the atomic claim loses the race', async () => {
      source.putDirect(profileSourcePath(USER, IMAGE), await makeJpeg());
      images.claimForProcessing.mockResolvedValue(false);
      await expect(service.commitUpload(USER, IMAGE, 'key-2')).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'PROFILE_IMAGE_ALREADY_COMMITTED' },
      });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('422 PROFILE_UPLOAD_MISSING when no bytes were uploaded', async () => {
      await expect(service.commitUpload(USER, IMAGE, 'key-3')).rejects.toMatchObject({
        status: 422,
        response: { errorCode: 'PROFILE_UPLOAD_MISSING' },
      });
    });

    it('409 ALREADY_COMMITTED when the row is not pending', async () => {
      images.findOwned.mockResolvedValue(readyRow()); // status ready
      await expect(service.commitUpload(USER, IMAGE, 'key-4')).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'PROFILE_IMAGE_ALREADY_COMMITTED' },
      });
    });
  });

  describe('requestUpload', () => {
    it('enforces the per-user in-flight ceiling (409)', async () => {
      images.countNonTerminalByUser.mockResolvedValue(5);
      await expect(service.requestUpload(USER, 'k')).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'PROFILE_TOO_MANY_UPLOADS' },
      });
    });

    it('creates a pending row and returns a signed PUT target', async () => {
      const res = await service.requestUpload(USER, 'k');
      expect(images.createPending).toHaveBeenCalled();
      expect(res.upload.method).toBe('PUT');
      expect(res.upload.url).toContain('/upload/');
      expect(idem.complete).toHaveBeenCalled();
    });

    it('replays a stored body on an idempotent retry', async () => {
      const stored = { profileImageId: IMAGE, upload: { method: 'PUT', url: 'u', token: 't', path: 'p', headers: {} } };
      idem.begin.mockResolvedValue({ outcome: 'replay', body: stored });
      const res = await service.requestUpload(USER, 'k');
      expect(res).toEqual(stored);
      expect(images.createPending).not.toHaveBeenCalled();
    });
  });
});
