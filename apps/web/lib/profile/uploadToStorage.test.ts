import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploadToStorage } from '@/lib/profile/uploadToStorage';
import type { AvatarUploadTarget } from '@/lib/types/api';

// The signed URL embeds the credential as a query token; the returned error message must never echo it.
const TOKEN = 'SECRET_TOKEN_abc123';
const URL_WITH_TOKEN = `https://vasihtrobeqxooujcryw.supabase.co/storage/v1/object/upload/sign/avatars/x?token=${TOKEN}`;

function target(headers: Record<string, string> = {}): AvatarUploadTarget {
  return { method: 'PUT', url: URL_WITH_TOKEN, headers };
}

function imageFile(type = 'image/png'): File {
  return new File([new Uint8Array([1, 2, 3, 4])], 'a', { type });
}

// A minimal Response-shaped stub — the SUT reads only `res.ok`, so we avoid depending on a global Response.
function response(ok: boolean, status = ok ? 200 : 500) {
  return { ok, status };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(response(true));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadToStorage', () => {
  it('PUTs the raw file to the target url and reports success on a 2xx', async () => {
    const file = imageFile();
    const res = await uploadToStorage(target({ 'x-upsert': 'true' }), file);

    expect(res).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(URL_WITH_TOKEN);
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(file); // the File itself, not a copy
  });

  it('forwards Content-Type = file.type and the x-upsert flag', async () => {
    await uploadToStorage(target({ 'x-upsert': 'true' }), imageFile('image/webp'));
    const init = fetchMock.mock.calls[0]![1];
    expect(init.headers).toEqual({ 'Content-Type': 'image/webp', 'x-upsert': 'true' });
  });

  it('omits x-upsert when the target does not carry it', async () => {
    await uploadToStorage(target(), imageFile('image/jpeg'));
    const init = fetchMock.mock.calls[0]![1];
    expect(init.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(init.headers).not.toHaveProperty('x-upsert');
  });

  it('NEVER forwards Authorization / apikey / Cookie even when the target echoes them', async () => {
    await uploadToStorage(
      target({
        Authorization: `Bearer ${TOKEN}`,
        apikey: TOKEN,
        Cookie: `sb-access-token=${TOKEN}`,
        'x-upsert': 'true',
      }),
      imageFile(),
    );

    const init = fetchMock.mock.calls[0]![1];
    expect(Object.keys(init.headers).sort()).toEqual(['Content-Type', 'x-upsert']);
    expect(init.headers).not.toHaveProperty('Authorization');
    expect(init.headers).not.toHaveProperty('apikey');
    expect(init.headers).not.toHaveProperty('Cookie');
  });

  it('combines the caller signal with a timeout; aborting the caller aborts the fetch signal (#217)', async () => {
    const controller = new AbortController();
    await uploadToStorage(target(), imageFile(), controller.signal);
    const passed = fetchMock.mock.calls[0]![1].signal as AbortSignal;
    expect(passed).toBeInstanceOf(AbortSignal);
    expect(passed.aborted).toBe(false);
    controller.abort();
    expect(passed.aborted).toBe(true); // caller cancellation still propagates through the combined signal
  });

  it('still applies a timeout when no caller signal is passed (#217)', async () => {
    await uploadToStorage(target(), imageFile());
    const passed = fetchMock.mock.calls[0]![1].signal as AbortSignal;
    expect(passed).toBeInstanceOf(AbortSignal); // the timeout signal, not undefined
  });

  it('returns a generic error (no url/token) on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(response(false, 403));
    const res = await uploadToStorage(target(), imageFile());
    expect(res.ok).toBe(false);
    const message = res.ok ? '' : res.message;
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain('supabase');
    expect(message).not.toContain('http');
  });

  it('returns a generic error (no url/token) when fetch rejects and never throws', async () => {
    fetchMock.mockRejectedValue(new Error(`connection to ${URL_WITH_TOKEN} refused`));
    const res = await uploadToStorage(target(), imageFile());
    expect(res.ok).toBe(false);
    const message = res.ok ? '' : res.message;
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain(URL_WITH_TOKEN);
  });
});
