import { describe, it, expect } from 'vitest';
import { isOptimizable, ALLOWED_IMAGE_HOST, PUBLIC_OBJECT_PATH_PREFIX } from '@/lib/images';

const host = ALLOWED_IMAGE_HOST;
const publicUrl = `https://${host}${PUBLIC_OBJECT_PATH_PREFIX}artworks/a.jpg`;
const signedUrl = `https://${host}/storage/v1/object/sign/artworks/a.jpg?token=abc`;

describe('isOptimizable', () => {
  it('accepts an allowlisted-host public-object URL with no query', () => {
    expect(isOptimizable(publicUrl)).toBe(true);
  });

  it('rejects a same-host SIGNED object (sign path + query) so it falls back to unoptimized', () => {
    expect(isOptimizable(signedUrl)).toBe(false);
  });

  it('rejects a same-host public path that carries a query string', () => {
    expect(isOptimizable(`${publicUrl}?width=100`)).toBe(false);
  });

  it('rejects an off-allowlist host', () => {
    expect(isOptimizable('https://signed.cdn.tove.test/img/a.jpg?token=1')).toBe(false);
    expect(isOptimizable('https://cdn.tove.test/aw-001.jpg')).toBe(false);
  });

  it('rejects a malformed URL without throwing', () => {
    expect(isOptimizable('not a url')).toBe(false);
  });
});
