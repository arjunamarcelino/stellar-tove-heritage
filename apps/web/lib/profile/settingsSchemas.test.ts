import { describe, it, expect } from 'vitest';
import type { MeProfile } from '@/lib/types/api';
import {
  parseHandle,
  buildHandleUrl,
  websiteUrlSchema,
  socialLinksSchema,
  profilePatchSchema,
  profileImageFileSchema,
  bioSchema,
  statementSchema,
  buildProfilePatch,
  mergeSocialLinks,
  profileToFormValues,
  type ProfileFormValues,
} from '@/lib/profile/settingsSchemas';

const baseProfile: MeProfile = {
  id: 'u1',
  email: 'a@b.co',
  handle: 'maya',
  bio: null,
  statement: null,
  socialLinks: null,
  profileImage: null,
};

const emptyForm: ProfileFormValues = {
  bio: '',
  statement: '',
  twitter: '',
  instagram: '',
  website: '',
};

describe('parseHandle', () => {
  it('accepts a bare handle', () => {
    expect(parseHandle('jane', 'twitter')).toEqual({ ok: true, handle: 'jane' });
  });
  it('strips a leading @ and trailing slash and whitespace', () => {
    expect(parseHandle('  @jane/ ', 'twitter')).toEqual({ ok: true, handle: 'jane' });
  });
  it('extracts the handle from a pasted profile URL', () => {
    expect(parseHandle('https://x.com/@Jane/', 'twitter')).toEqual({ ok: true, handle: 'Jane' });
    expect(parseHandle('twitter.com/jane', 'twitter')).toEqual({ ok: true, handle: 'jane' });
    expect(parseHandle('https://www.instagram.com/jane/', 'instagram')).toEqual({
      ok: true,
      handle: 'jane',
    });
  });
  it('rejects a wrong-platform URL', () => {
    const r = parseHandle('https://instagram.com/jane', 'twitter');
    expect(r.ok).toBe(false);
  });
  it('rejects empty / whitespace-only', () => {
    expect(parseHandle('   ', 'twitter').ok).toBe(false);
  });
  it('rejects invalid characters and spaces', () => {
    expect(parseHandle('ja ne', 'twitter').ok).toBe(false);
    expect(parseHandle('a'.repeat(31), 'twitter').ok).toBe(false);
  });
  it('round-trips with buildHandleUrl for both platforms', () => {
    for (const p of ['twitter', 'instagram'] as const) {
      const parsed = parseHandle(buildHandleUrl('jane_01', p), p);
      expect(parsed).toEqual({ ok: true, handle: 'jane_01' });
    }
  });
});

describe('buildHandleUrl', () => {
  it('builds x.com / instagram.com URLs', () => {
    expect(buildHandleUrl('me', 'twitter')).toBe('https://x.com/me');
    expect(buildHandleUrl('me', 'instagram')).toBe('https://instagram.com/me');
  });
});

describe('websiteUrlSchema', () => {
  it('accepts a valid https URL', () => {
    expect(websiteUrlSchema.safeParse('https://me.art').success).toBe(true);
  });
  it('rejects http, javascript:, data: and embedded credentials', () => {
    for (const bad of [
      'http://me.art',
      'javascript:alert(1)',
      'data:text/html,x',
      'https://user:pass@me.art',
      'not a url',
    ]) {
      expect(websiteUrlSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('bio/statement schemas', () => {
  it('enforce max length in UTF-16 units and allow null', () => {
    expect(bioSchema.safeParse('x'.repeat(300)).success).toBe(true);
    expect(bioSchema.safeParse('x'.repeat(301)).success).toBe(false);
    expect(bioSchema.safeParse(null).success).toBe(true);
    expect(statementSchema.safeParse('x'.repeat(500)).success).toBe(true);
    expect(statementSchema.safeParse('x'.repeat(501)).success).toBe(false);
  });
});

describe('profilePatchSchema', () => {
  it('accepts declared keys incl. explicit null', () => {
    expect(
      profilePatchSchema.safeParse({ bio: null, socialLinks: null, profileImageId: null }).success,
    ).toBe(true);
    expect(
      profilePatchSchema.safeParse({
        bio: 'hi',
        socialLinks: { twitter: 'https://x.com/me' },
        profileImageId: '0b3a1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      }).success,
    ).toBe(true);
  });
  it('rejects an unknown key (forbidNonWhitelisted parity)', () => {
    expect(profilePatchSchema.safeParse({ bio: 'hi', nickname: 'x' }).success).toBe(false);
  });
  it('rejects a non-uuid profileImageId and a non-https social URL', () => {
    expect(profilePatchSchema.safeParse({ profileImageId: 'not-a-uuid' }).success).toBe(false);
    expect(
      profilePatchSchema.safeParse({ socialLinks: { twitter: 'http://x.com/me' } }).success,
    ).toBe(false);
  });
});

describe('socialLinksSchema', () => {
  it('rejects an undeclared platform key', () => {
    expect(socialLinksSchema.safeParse({ tiktok: 'https://tiktok.com/me' }).success).toBe(false);
  });
});

describe('profileImageFileSchema', () => {
  const file = (bytes: number, type: string) => new File([new Uint8Array(bytes)], 'a', { type });
  it('accepts a small jpeg/png/webp', () => {
    expect(profileImageFileSchema.safeParse(file(10, 'image/jpeg')).success).toBe(true);
    expect(profileImageFileSchema.safeParse(file(10, 'image/webp')).success).toBe(true);
  });
  it('rejects empty, oversize, and wrong type', () => {
    expect(profileImageFileSchema.safeParse(file(0, 'image/png')).success).toBe(false);
    expect(profileImageFileSchema.safeParse(file(5 * 1024 * 1024 + 1, 'image/png')).success).toBe(
      false,
    );
    expect(profileImageFileSchema.safeParse(file(10, 'image/gif')).success).toBe(false);
    expect(profileImageFileSchema.safeParse(file(10, 'image/svg+xml')).success).toBe(false);
  });
});

describe('mergeSocialLinks', () => {
  it('returns null when all inputs are empty', () => {
    expect(mergeSocialLinks(emptyForm)).toBeNull();
  });
  it('builds a whole object and preserves untouched platforms', () => {
    expect(mergeSocialLinks({ ...emptyForm, twitter: '@me', instagram: 'me2' })).toEqual({
      twitter: 'https://x.com/me',
      instagram: 'https://instagram.com/me2',
    });
  });
  it('passes a full https website through', () => {
    expect(mergeSocialLinks({ ...emptyForm, website: 'https://me.art' })).toEqual({
      website: 'https://me.art',
    });
  });
});

describe('buildProfilePatch', () => {
  it('is empty when nothing changed', () => {
    expect(buildProfilePatch(emptyForm, baseProfile)).toEqual({});
  });
  it('sends an explicit null when a field is cleared', () => {
    const snap: MeProfile = { ...baseProfile, bio: 'old' };
    expect(buildProfilePatch(emptyForm, snap)).toEqual({ bio: null });
  });
  it('sends only changed keys', () => {
    expect(buildProfilePatch({ ...emptyForm, bio: 'new' }, baseProfile)).toEqual({ bio: 'new' });
  });
  it('clearing one platform preserves the other (whole-object replace)', () => {
    const snap: MeProfile = {
      ...baseProfile,
      socialLinks: { twitter: 'https://x.com/me', instagram: 'https://instagram.com/me2' },
    };
    const form: ProfileFormValues = { ...emptyForm, instagram: 'me2' }; // twitter cleared
    expect(buildProfilePatch(form, snap)).toEqual({
      socialLinks: { instagram: 'https://instagram.com/me2' },
    });
  });
  it('does not false-dirty a loaded profile (round-trip stable)', () => {
    const snap: MeProfile = {
      ...baseProfile,
      bio: 'hello',
      socialLinks: { twitter: 'https://x.com/me' },
    };
    expect(buildProfilePatch(profileToFormValues(snap), snap)).toEqual({});
  });

  it('does not false-dirty a stored twitter.com link (host-agnostic compare, #221)', () => {
    const snap: MeProfile = {
      ...baseProfile,
      socialLinks: { twitter: 'https://twitter.com/me', instagram: 'https://instagram.com/me2' },
    };
    // Loading reverses to handles, rebuilding emits x.com; the compare must treat twitter.com == x.com.
    expect(buildProfilePatch(profileToFormValues(snap), snap)).toEqual({});
    // Editing an unrelated field must not drag socialLinks along.
    expect(buildProfilePatch({ ...profileToFormValues(snap), bio: 'hi' }, snap)).toEqual({ bio: 'hi' });
  });
});

describe('profileToFormValues', () => {
  it('reverses stored URLs back to bare handles', () => {
    const snap: MeProfile = {
      ...baseProfile,
      socialLinks: { twitter: 'https://x.com/me', website: 'https://me.art' },
    };
    expect(profileToFormValues(snap)).toEqual({
      bio: '',
      statement: '',
      twitter: 'me',
      instagram: '',
      website: 'https://me.art',
    });
  });
});
