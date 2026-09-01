import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  readAccessToken: vi.fn(),
  updateProfile: vi.fn(),
  requestProfileImageUpload: vi.fn(),
  commitProfileImage: vi.fn(),
  getProfileImageStatus: vi.fn(),
}));

vi.mock('@/lib/cookies', () => ({ readAccessToken: h.readAccessToken }));
vi.mock('@/lib/services/profile', () => ({
  updateProfile: h.updateProfile,
  requestProfileImageUpload: h.requestProfileImageUpload,
  commitProfileImage: h.commitProfileImage,
  getProfileImageStatus: h.getProfileImageStatus,
}));

import {
  updateProfileAction,
  requestAvatarUploadAction,
  commitAvatarAction,
  getAvatarStatusAction,
  setAvatarAction,
} from '@/app/actions/profile';

const IMG_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

beforeEach(() => {
  vi.clearAllMocks();
  h.readAccessToken.mockResolvedValue('tok'); // authenticated by default
});

describe('updateProfileAction', () => {
  it('returns SESSION_EXPIRED and does not call the service without a token', async () => {
    h.readAccessToken.mockResolvedValue(null);
    expect(await updateProfileAction({ bio: 'hi' })).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(h.updateProfile).not.toHaveBeenCalled();
  });

  it('rejects an invalid patch (unknown key) before delegating', async () => {
    // @ts-expect-error — an undeclared key must be rejected by the strict schema.
    const result = await updateProfileAction({ nope: 'x' });
    expect(result).toMatchObject({ status: 'error', code: 'VALIDATION_FAILED' });
    expect(h.updateProfile).not.toHaveBeenCalled();
  });

  it('delegates with the cookie token + parsed patch on a valid input', async () => {
    const success = { status: 'success', profile: {} };
    h.updateProfile.mockResolvedValue(success);
    const result = await updateProfileAction({ bio: 'hi' });
    expect(result).toBe(success);
    expect(h.updateProfile).toHaveBeenCalledWith('tok', { bio: 'hi' });
  });
});

describe('requestAvatarUploadAction', () => {
  it('returns SESSION_EXPIRED and does not call the service without a token', async () => {
    h.readAccessToken.mockResolvedValue(null);
    expect(await requestAvatarUploadAction('key-1')).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(h.requestProfileImageUpload).not.toHaveBeenCalled();
  });

  it('forwards the passed idempotency key with the cookie token', async () => {
    const success = { status: 'success', profileImageId: IMG_ID, upload: {} };
    h.requestProfileImageUpload.mockResolvedValue(success);
    expect(await requestAvatarUploadAction('key-1')).toBe(success);
    expect(h.requestProfileImageUpload).toHaveBeenCalledWith('tok', 'key-1');
  });
});

describe('commitAvatarAction', () => {
  it('returns SESSION_EXPIRED and does not call the service without a token', async () => {
    h.readAccessToken.mockResolvedValue(null);
    expect(await commitAvatarAction(IMG_ID, 'key-2')).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(h.commitProfileImage).not.toHaveBeenCalled();
  });

  it('forwards the id + passed idempotency key with the cookie token', async () => {
    const success = { status: 'success', profileImageId: IMG_ID, imageStatus: 'processing' };
    h.commitProfileImage.mockResolvedValue(success);
    expect(await commitAvatarAction(IMG_ID, 'key-2')).toBe(success);
    expect(h.commitProfileImage).toHaveBeenCalledWith('tok', IMG_ID, 'key-2');
  });
});

describe('getAvatarStatusAction', () => {
  it('returns SESSION_EXPIRED and does not call the service without a token', async () => {
    h.readAccessToken.mockResolvedValue(null);
    expect(await getAvatarStatusAction(IMG_ID)).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(h.getProfileImageStatus).not.toHaveBeenCalled();
  });

  it('delegates with the cookie token', async () => {
    const success = { status: 'success', profileImageId: IMG_ID, imageStatus: 'ready' };
    h.getProfileImageStatus.mockResolvedValue(success);
    expect(await getAvatarStatusAction(IMG_ID)).toBe(success);
    expect(h.getProfileImageStatus).toHaveBeenCalledWith('tok', IMG_ID);
  });
});

describe('setAvatarAction', () => {
  it('returns SESSION_EXPIRED and does not call the service without a token', async () => {
    h.readAccessToken.mockResolvedValue(null);
    expect(await setAvatarAction(IMG_ID)).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(h.updateProfile).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid profileImageId before delegating', async () => {
    const result = await setAvatarAction('not-a-uuid');
    expect(result).toMatchObject({ status: 'error', code: 'VALIDATION_FAILED' });
    expect(h.updateProfile).not.toHaveBeenCalled();
  });

  it('PATCHes { profileImageId } with a uuid via updateProfile', async () => {
    const success = { status: 'success', profile: {} };
    h.updateProfile.mockResolvedValue(success);
    expect(await setAvatarAction(IMG_ID)).toBe(success);
    expect(h.updateProfile).toHaveBeenCalledWith('tok', { profileImageId: IMG_ID });
  });

  it('PATCHes { profileImageId: null } to clear the avatar', async () => {
    const success = { status: 'success', profile: {} };
    h.updateProfile.mockResolvedValue(success);
    expect(await setAvatarAction(null)).toBe(success);
    expect(h.updateProfile).toHaveBeenCalledWith('tok', { profileImageId: null });
  });
});
