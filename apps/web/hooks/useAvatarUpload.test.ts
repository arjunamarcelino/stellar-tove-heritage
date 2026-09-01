import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type {
  ProfileImageUrls,
  MeProfile,
  AvatarUploadTarget,
  UpdateProfileResult,
} from '@/lib/types/api';
import { AVATAR_POLL_INTERVAL_MS, AVATAR_POLL_MAX_ATTEMPTS } from '@/lib/profile/settingsConstants';

const h = vi.hoisted(() => ({
  request: vi.fn(),
  commit: vi.fn(),
  status: vi.fn(),
  setAvatar: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('@/app/actions/profile', () => ({
  requestAvatarUploadAction: h.request,
  commitAvatarAction: h.commit,
  getAvatarStatusAction: h.status,
  setAvatarAction: h.setAvatar,
}));
vi.mock('@/lib/profile/uploadToStorage', () => ({ uploadToStorage: h.upload }));

import { useAvatarUpload } from '@/hooks/useAvatarUpload';

const IMG: ProfileImageUrls = {
  thumbUrl: 'https://cdn.test/thumb.webp',
  cardUrl: 'https://cdn.test/card.webp',
  heroUrl: 'https://cdn.test/hero.webp',
};

const TARGET: AvatarUploadTarget = {
  method: 'PUT',
  url: 'https://storage.test/upload?token=t',
  headers: {},
};

function profileWith(image: ProfileImageUrls | null): MeProfile {
  return {
    id: 'u1',
    email: 'a@b.test',
    handle: 'h',
    bio: null,
    statement: null,
    socialLinks: null,
    profileImage: image,
  };
}

const activateOk: UpdateProfileResult = { status: 'success', profile: profileWith(IMG) };

// PNG magic bytes so isSupportedImage (inside preflightImage) passes; type matches the allowlist.
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
function pngFile(name = 'photo.png'): File {
  return new File([new Uint8Array(PNG_BYTES)], name, { type: 'image/png' });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeOpts() {
  return { onAvatarActivated: vi.fn(), onSessionExpired: vi.fn() };
}

const INTERVAL = AVATAR_POLL_INTERVAL_MS;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Preview object URL + off-thread decode (createImageBitmap) are not implemented in jsdom. Object.assign
  // onto the real URL keeps the `new URL()` constructor intact while adding the two static blob helpers.
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:preview'),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn().mockResolvedValue({ width: 512, height: 512, close: vi.fn() }),
  );
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '11111111-1111-4111-8111-111111111111') });

  // Sensible happy-path defaults; individual tests override.
  h.request.mockResolvedValue({ status: 'success', profileImageId: 'img-1', upload: TARGET });
  h.upload.mockResolvedValue({ ok: true });
  h.commit.mockResolvedValue({
    status: 'success',
    profileImageId: 'img-1',
    imageStatus: 'processing',
  });
  h.status.mockResolvedValue({
    status: 'success',
    profileImageId: 'img-1',
    imageStatus: 'processing',
  });
  h.setAvatar.mockResolvedValue(activateOk);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useAvatarUpload', () => {
  it('runs the full pipeline to active and reports the activated image', async () => {
    h.status.mockResolvedValue({
      status: 'success',
      profileImageId: 'img-1',
      imageStatus: 'ready',
    });
    const opts = makeOpts();
    const { result } = renderHook(() => useAvatarUpload(null, opts));

    await act(async () => {
      await result.current.selectFile(pngFile());
    });
    expect(h.request).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(h.upload).toHaveBeenCalledWith(TARGET, expect.any(File), expect.any(AbortSignal));
    expect(h.commit).toHaveBeenCalledWith('img-1', '11111111-1111-4111-8111-111111111111');
    expect(result.current.state.status).toBe('processing');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(h.setAvatar).toHaveBeenCalledWith('img-1');
    expect(result.current.state.status).toBe('active');
    expect(result.current.activeImage).toEqual(IMG);
    expect(opts.onAvatarActivated).toHaveBeenCalledWith(IMG);
  });

  it('treats an idempotent commit success (409 replay) as success and proceeds to poll', async () => {
    h.commit.mockResolvedValue({
      status: 'success',
      profileImageId: 'img-1',
      imageStatus: 'processing',
    });
    h.status
      .mockResolvedValueOnce({
        status: 'success',
        profileImageId: 'img-1',
        imageStatus: 'processing',
      })
      .mockResolvedValue({ status: 'success', profileImageId: 'img-1', imageStatus: 'ready' });
    const { result } = renderHook(() => useAvatarUpload(null, makeOpts()));

    await act(async () => {
      await result.current.selectFile(pngFile());
    });
    expect(result.current.state.status).toBe('processing');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    });
    expect(result.current.state.status).toBe('active');
  });

  it('maps a commit error to the error state with the commit phase', async () => {
    h.commit.mockResolvedValue({
      status: 'error',
      code: 'PROFILE_IMAGE_INVALID',
      message: 'That file could not be processed.',
    });
    const { result } = renderHook(() => useAvatarUpload(null, makeOpts()));

    await act(async () => {
      await result.current.selectFile(pngFile());
    });
    expect(result.current.state).toMatchObject({
      status: 'error',
      phase: 'commit',
      code: 'PROFILE_IMAGE_INVALID',
    });
    expect(h.status).not.toHaveBeenCalled();
  });

  it('goes to failed (clearing the preview) when derivation reports failed', async () => {
    h.status.mockResolvedValue({
      status: 'success',
      profileImageId: 'img-1',
      imageStatus: 'failed',
    });
    const { result } = renderHook(() => useAvatarUpload(null, makeOpts()));

    await act(async () => {
      await result.current.selectFile(pngFile());
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(result.current.state).toEqual({ status: 'failed', reason: 'processing' });
    expect(result.current.previewUrl).toBeNull();
    expect(h.setAvatar).not.toHaveBeenCalled();
  });

  it('times out after the processing poll cap', async () => {
    h.status.mockResolvedValue({
      status: 'success',
      profileImageId: 'img-1',
      imageStatus: 'processing',
    });
    const { result } = renderHook(() => useAvatarUpload(null, makeOpts()));

    await act(async () => {
      await result.current.selectFile(pngFile());
    });
    for (let i = 0; i < AVATAR_POLL_MAX_ATTEMPTS + 1; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(INTERVAL);
      });
    }
    expect(result.current.state.status).toBe('timedOut');
    expect(h.setAvatar).not.toHaveBeenCalled();
  });

  it('ignores a late ready for a superseded attempt when a new file is picked mid-poll', async () => {
    const gate = deferred<{ status: 'success'; profileImageId: string; imageStatus: 'ready' }>();
    // First poll (attempt A) stays in-flight until we resolve the gate.
    h.status.mockReturnValueOnce(gate.promise);
    const opts = makeOpts();
    const { result } = renderHook(() => useAvatarUpload(null, opts));

    await act(async () => {
      await result.current.selectFile(pngFile('a.png'));
    });
    // Fire attempt A's first poll — it awaits the gate (in-flight).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });

    // A new file starts attempt B (bumps the generation). B keeps processing.
    h.request.mockResolvedValue({ status: 'success', profileImageId: 'img-2', upload: TARGET });
    h.commit.mockResolvedValue({
      status: 'success',
      profileImageId: 'img-2',
      imageStatus: 'processing',
    });
    h.status.mockResolvedValue({
      status: 'success',
      profileImageId: 'img-2',
      imageStatus: 'processing',
    });
    await act(async () => {
      await result.current.selectFile(pngFile('b.png'));
    });

    // A's late ready lands — it must be ignored (stale generation), so no activation happens.
    await act(async () => {
      gate.resolve({ status: 'success', profileImageId: 'img-1', imageStatus: 'ready' });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.setAvatar).not.toHaveBeenCalled();
    expect(result.current.state.status).not.toBe('active');
    expect(opts.onAvatarActivated).not.toHaveBeenCalled();
  });

  it('does not wedge the new attempt when re-picking during a hung status poll (#216)', async () => {
    const gate = deferred<{ status: 'success'; profileImageId: string; imageStatus: 'ready' }>();
    // Attempt A's first poll hangs in-flight until we resolve the gate.
    h.status.mockReturnValueOnce(gate.promise);
    const opts = makeOpts();
    const { result } = renderHook(() => useAvatarUpload(null, opts));

    await act(async () => {
      await result.current.selectFile(pngFile('a.png'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL); // A's poll fires and hangs (holds inFlightRef)
    });
    expect(result.current.state.status).toBe('processing');

    // Re-pick B while A's poll is still hung. B's derivation is ready.
    h.request.mockResolvedValue({ status: 'success', profileImageId: 'img-2', upload: TARGET });
    h.commit.mockResolvedValue({
      status: 'success',
      profileImageId: 'img-2',
      imageStatus: 'processing',
    });
    h.status.mockResolvedValue({
      status: 'success',
      profileImageId: 'img-2',
      imageStatus: 'ready',
    });
    await act(async () => {
      await result.current.selectFile(pngFile('b.png'));
    });

    // B's poll must run (NOT blocked by A's stale inFlightRef) and activate — the pre-#216 wedge left it
    // stuck on "processing" forever here.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(h.setAvatar).toHaveBeenCalledWith('img-2');
    expect(result.current.state.status).toBe('active');

    // A's hung poll finally resolves — ignored (stale generation), so only B ever activated.
    await act(async () => {
      gate.resolve({ status: 'success', profileImageId: 'img-1', imageStatus: 'ready' });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.setAvatar).toHaveBeenCalledTimes(1);
  });

  it('surfaces a schema/pre-flight rejection as an upload-phase error without starting the pipeline', async () => {
    const { result } = renderHook(() => useAvatarUpload(null, makeOpts()));
    const bad = new File([new Uint8Array([1, 2, 3])], 'note.txt', { type: 'text/plain' });

    await act(async () => {
      await result.current.selectFile(bad);
    });
    expect(result.current.state).toMatchObject({
      status: 'error',
      phase: 'upload',
      code: 'UPLOAD_FAILED',
    });
    expect(h.request).not.toHaveBeenCalled();
  });

  it('the last-picked file wins even if its pre-flight decode resolves first (#218)', async () => {
    const gateA = deferred<{ width: number; height: number; close: () => void }>();
    const gateB = deferred<{ width: number; height: number; close: () => void }>();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockReturnValueOnce(gateA.promise).mockReturnValueOnce(gateB.promise),
    );
    const opts = makeOpts();
    const { result } = renderHook(() => useAvatarUpload(null, opts));

    // Pick A then B without awaiting — both are mid-preflight; B's synchronous generation bump wins.
    let pA!: Promise<void>;
    let pB!: Promise<void>;
    await act(async () => {
      pA = result.current.selectFile(pngFile('a.png'));
      pB = result.current.selectFile(pngFile('b.png'));
    });
    // Resolve B's decode FIRST (later pick, faster decode), then A's.
    await act(async () => {
      gateB.resolve({ width: 512, height: 512, close: vi.fn() });
      await pB;
    });
    await act(async () => {
      gateA.resolve({ width: 512, height: 512, close: vi.fn() });
      await pA;
    });

    // Only B's pipeline ran; A's late preflight no-oped on the stale generation.
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect((h.upload.mock.calls[0]![1] as File).name).toBe('b.png');
  });

  it('a pending pick does not override a subsequent removeAvatar (#218)', async () => {
    const gate = deferred<{ width: number; height: number; close: () => void }>();
    vi.stubGlobal('createImageBitmap', vi.fn().mockReturnValue(gate.promise));
    h.setAvatar.mockResolvedValue({ status: 'success', profile: profileWith(null) });
    const opts = makeOpts();
    const { result } = renderHook(() => useAvatarUpload(IMG, opts));

    let pPick!: Promise<void>;
    await act(async () => {
      pPick = result.current.selectFile(pngFile('a.png')); // gen bumped, preflight pending
      await result.current.removeAvatar(); // later action bumps the generation again and removes
    });
    expect(h.setAvatar).toHaveBeenCalledWith(null);
    expect(result.current.activeImage).toBeNull();

    // The pick's preflight now resolves — it must no-op (stale generation), not start an upload.
    await act(async () => {
      gate.resolve({ width: 512, height: 512, close: vi.fn() });
      await pPick;
    });
    expect(h.request).not.toHaveBeenCalled();
    expect(result.current.activeImage).toBeNull();
  });

  it('stops and calls onSessionExpired when an action returns SESSION_EXPIRED', async () => {
    h.request.mockResolvedValue({ status: 'error', code: 'SESSION_EXPIRED', message: 'expired' });
    const opts = makeOpts();
    const { result } = renderHook(() => useAvatarUpload(null, opts));

    await act(async () => {
      await result.current.selectFile(pngFile());
    });
    expect(opts.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(h.upload).not.toHaveBeenCalled();
    expect(result.current.state.status).not.toBe('active');
  });

  it('removeAvatar clears the active image and reports it, then returns to idle', async () => {
    h.setAvatar.mockResolvedValue({ status: 'success', profile: profileWith(null) });
    const opts = makeOpts();
    const { result } = renderHook(() => useAvatarUpload(IMG, opts));
    expect(result.current.activeImage).toEqual(IMG);

    await act(async () => {
      await result.current.removeAvatar();
    });
    expect(h.setAvatar).toHaveBeenCalledWith(null);
    expect(result.current.activeImage).toBeNull();
    expect(result.current.state.status).toBe('idle');
    expect(opts.onAvatarActivated).toHaveBeenCalledWith(null);
  });

  it('retry() from timedOut resumes polling the same image without re-uploading', async () => {
    h.status.mockResolvedValue({
      status: 'success',
      profileImageId: 'img-1',
      imageStatus: 'processing',
    });
    const { result } = renderHook(() => useAvatarUpload(null, makeOpts()));

    await act(async () => {
      await result.current.selectFile(pngFile());
    });
    for (let i = 0; i < AVATAR_POLL_MAX_ATTEMPTS + 1; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(INTERVAL);
      });
    }
    expect(result.current.state.status).toBe('timedOut');
    const uploadsBefore = h.upload.mock.calls.length;

    // Derivation finished in the meantime; Check again re-arms the poll and lands active.
    h.status.mockResolvedValue({
      status: 'success',
      profileImageId: 'img-1',
      imageStatus: 'ready',
    });
    act(() => {
      result.current.retry();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    expect(result.current.state.status).toBe('active');
    expect(h.upload.mock.calls.length).toBe(uploadsBefore); // never re-uploaded
  });
});
