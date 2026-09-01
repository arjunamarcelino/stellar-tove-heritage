import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isSupportedImage, preflightImage } from '@/lib/profile/imageFile';

function fileWith(bytes: number[], type: string): File {
  return new File([new Uint8Array(bytes)], 'photo', { type });
}

const JPEG = [0xff, 0xd8, 0xff, 0x00];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];

beforeEach(() => {
  // jsdom canvas has no 2d context, so preflightImage's preview builder falls back to URL.createObjectURL;
  // stub it (jsdom leaves it unimplemented) so the fallback returns a deterministic string.
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isSupportedImage', () => {
  it('accepts jpeg/png/webp when the header agrees with the MIME', async () => {
    expect(await isSupportedImage(fileWith(JPEG, 'image/jpeg'))).toBe(true);
    expect(await isSupportedImage(fileWith(PNG, 'image/png'))).toBe(true);
    expect(await isSupportedImage(fileWith(WEBP, 'image/webp'))).toBe(true);
  });

  it('rejects a spoofed extension (header disagrees with MIME)', async () => {
    expect(await isSupportedImage(fileWith(PNG, 'image/jpeg'))).toBe(false);
  });

  it('rejects a RIFF container that is not WEBP (e.g. WAV/AVI)', async () => {
    const riffWav = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45];
    expect(await isSupportedImage(fileWith(riffWav, 'image/webp'))).toBe(false);
  });

  it('rejects an unknown/SVG file', async () => {
    expect(await isSupportedImage(fileWith([0x3c, 0x73, 0x76, 0x67], 'image/svg+xml'))).toBe(false);
  });
});

describe('preflightImage', () => {
  it('fails fast on an unsupported file without decoding', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    const r = await preflightImage(fileWith([0, 0, 0], 'image/png'));
    expect(r.ok).toBe(false);
    expect(decode).not.toHaveBeenCalled();
  });

  it('passes a decodable image within the dimension bound and returns a preview URL', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 800, height: 600, close }),
    );
    const r = await preflightImage(fileWith(JPEG, 'image/jpeg'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(typeof r.previewUrl).toBe('string');
    expect(close).toHaveBeenCalled(); // the single decode is released
  });

  it('rejects an absurdly large (decompression-bomb) image', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 20000, height: 20000, close: vi.fn() }),
    );
    const r = await preflightImage(fileWith(PNG, 'image/png'));
    expect(r.ok).toBe(false);
  });

  it('rejects an undecodable file (createImageBitmap throws)', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')));
    const r = await preflightImage(fileWith(WEBP, 'image/webp'));
    expect(r.ok).toBe(false);
  });
});
