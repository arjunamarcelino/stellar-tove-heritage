import { describe, it, expect } from 'vitest';
import { validateAndBuildPatch } from '@modules/users/profile/profile-validation';

describe('validateAndBuildPatch (TOV-30)', () => {
  it('leaves absent keys out of the patch and keeps present keys', () => {
    const { patch, errors } = validateAndBuildPatch({ bio: 'hello' });
    expect(errors).toEqual([]);
    expect(patch).toEqual({ bio: 'hello' });
    expect('statement' in patch).toBe(false);
    expect('socialLinks' in patch).toBe(false);
    expect('profileImageId' in patch).toBe(false);
  });

  it('treats explicit null and empty string as a clear', () => {
    expect(validateAndBuildPatch({ bio: null }).patch).toEqual({ bio: null });
    expect(validateAndBuildPatch({ statement: '   ' }).patch).toEqual({ statement: null });
  });

  it('trims text and rejects over-length', () => {
    expect(validateAndBuildPatch({ bio: '  trimmed  ' }).patch).toEqual({ bio: 'trimmed' });
    const long = validateAndBuildPatch({ bio: 'a'.repeat(301) });
    expect(long.errors).toEqual([expect.objectContaining({ field: 'bio' })]);
    const stmt = validateAndBuildPatch({ statement: 'a'.repeat(501) });
    expect(stmt.errors).toEqual([expect.objectContaining({ field: 'statement' })]);
  });

  it('rejects control characters in text', () => {
    const { errors } = validateAndBuildPatch({ bio: "bad" + String.fromCharCode(7) + "value" });
    expect(errors).toEqual([expect.objectContaining({ field: 'bio' })]);
  });

  it('accepts host-allowlisted social links and normalizes them', () => {
    const { patch, errors } = validateAndBuildPatch({
      socialLinks: {
        twitter: 'https://x.com/collector',
        instagram: 'https://instagram.com/collector',
        website: 'https://collector.art',
      },
    });
    expect(errors).toEqual([]);
    expect(patch.socialLinks).toEqual({
      twitter: 'https://x.com/collector',
      instagram: 'https://instagram.com/collector',
      website: 'https://collector.art',
    });
  });

  it('rejects a wrong-host / non-https / malformed twitter link, naming socialLinks.twitter', () => {
    for (const twitter of ['https://foo.com/x', 'http://x.com/foo', 'not-a-url']) {
      const { errors } = validateAndBuildPatch({ socialLinks: { twitter } });
      expect(errors).toEqual([expect.objectContaining({ field: 'socialLinks.twitter' })]);
    }
  });

  it('rejects an unknown social platform key', () => {
    const { errors } = validateAndBuildPatch({ socialLinks: { facebook: 'https://facebook.com/x' } });
    expect(errors).toEqual([expect.objectContaining({ field: 'socialLinks.facebook' })]);
  });

  it('clears per-platform with null/empty and stores null for an empty object', () => {
    expect(
      validateAndBuildPatch({ socialLinks: { twitter: 'https://x.com/a', instagram: null } }).patch
        .socialLinks,
    ).toEqual({ twitter: 'https://x.com/a' });
    expect(validateAndBuildPatch({ socialLinks: {} }).patch.socialLinks).toBeNull();
    expect(validateAndBuildPatch({ socialLinks: null }).patch.socialLinks).toBeNull();
  });

  it('validates profileImageId as a UUID or null', () => {
    const id = '0b3a1c2d-4e5f-6a7b-8c9d-0e1f2a3b4c5d';
    expect(validateAndBuildPatch({ profileImageId: id }).patch).toEqual({ profileImageId: id });
    expect(validateAndBuildPatch({ profileImageId: null }).patch).toEqual({ profileImageId: null });
    expect(validateAndBuildPatch({ profileImageId: 'nope' }).errors).toEqual([
      expect.objectContaining({ field: 'profileImageId' }),
    ]);
  });

  it('is a true no-op for an empty body', () => {
    const { patch, errors } = validateAndBuildPatch({});
    expect(patch).toEqual({});
    expect(errors).toEqual([]);
  });

  it('rejects zero-width / bidi / tag-block characters in text', () => {
    for (const cp of [0x200b, 0x202e, 0x2060, 0x2028, 0x061c, 0xe0001]) {
      const bio = `ok${String.fromCodePoint(cp)}text`;
      expect(validateAndBuildPatch({ bio }).errors).toEqual([
        expect.objectContaining({ field: 'bio' }),
      ]);
    }
  });
});
