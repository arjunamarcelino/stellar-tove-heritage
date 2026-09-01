import { z } from 'zod/v4';
import type { MeProfile, SocialLinks } from '@/lib/types/api';
import {
  BIO_MAX_LENGTH,
  STATEMENT_MAX_LENGTH,
  PROFILE_IMAGE_MAX_BYTES,
  PROFILE_IMAGE_MIME,
} from '@/lib/profile/settingsConstants';

// Single source of truth for profile-settings input validation + transforms (TOV-35 / FR-01.09), shared
// across the client form, the Server Action, and the service. Co-located here (not in the `server-only`
// service) via the same shared-across-layers exception as lib/handle/schemas.ts / lib/kyc/schemas.ts — the
// client can't import a `server-only` module, so a plain shared module is required. The client is the
// pre-flight gate; the backend re-validates as the real authority (and owns social-link host rules).

// ── Social handles: parse ⇄ build (exact inverses so load→edit→save round-trips are stable, R7) ──

type SocialPlatform = 'twitter' | 'instagram';
const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;
const PLATFORM_HOSTS: Record<SocialPlatform, readonly string[]> = {
  twitter: ['x.com', 'twitter.com'],
  instagram: ['instagram.com'],
};
const PLATFORM_BASE: Record<SocialPlatform, string> = {
  twitter: 'https://x.com/',
  instagram: 'https://instagram.com/',
};
const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  twitter: 'X (Twitter)',
  instagram: 'Instagram',
};

export type ParseHandleResult = { ok: true; handle: string } | { ok: false; message: string };

// Lenient: accept a bare handle OR a pasted profile URL. Strips a leading @, whitespace, and a trailing
// slash; extracts the last path segment from a URL and rejects a wrong-platform host. The one function used
// at BOTH load-time (reversing a stored URL) and edit-time, so it can never diverge from itself.
export function parseHandle(input: string, platform: SocialPlatform): ParseHandleResult {
  let raw = input.trim().replace(/^@+/, '');
  if (raw === '') return { ok: false, message: `Enter your ${PLATFORM_LABEL[platform]} handle.` };

  const looksLikeUrl =
    /^https?:\/\//i.test(raw) || /\b(x\.com|twitter\.com|instagram\.com)\b/i.test(raw);
  if (looksLikeUrl) {
    const urlStr = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let url: URL;
    try {
      url = new URL(urlStr);
    } catch {
      return {
        ok: false,
        message: `That doesn’t look like a valid ${PLATFORM_LABEL[platform]} link.`,
      };
    }
    const host = url.host.replace(/^www\./i, '').toLowerCase();
    if (!PLATFORM_HOSTS[platform].includes(host)) {
      return { ok: false, message: `That link isn’t a ${PLATFORM_LABEL[platform]} URL.` };
    }
    raw = (url.pathname.replace(/^\/+/, '').replace(/\/+$/, '').split('/')[0] ?? '').replace(
      /^@+/,
      '',
    );
  } else {
    raw = raw.replace(/\/+$/, '');
  }

  if (!HANDLE_RE.test(raw)) {
    return {
      ok: false,
      message: `Use letters, numbers, . or _ (max 30) for your ${PLATFORM_LABEL[platform]} handle.`,
    };
  }
  return { ok: true, handle: raw };
}

// The single URL builder — inverse of parseHandle. `parseHandle(buildHandleUrl(h, p), p).handle === h`.
export function buildHandleUrl(handle: string, platform: SocialPlatform): string {
  return `${PLATFORM_BASE[platform]}${handle}`;
}

// ── Field schemas (mirror the backend limits) ────────

export const bioSchema = z.string().max(BIO_MAX_LENGTH).nullable();
export const statementSchema = z.string().max(STATEMENT_MAX_LENGTH).nullable();

function isHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    // https only; reject embedded credentials (user:pass@host — a display-spoofing vector).
    return u.protocol === 'https:' && u.username === '' && u.password === '';
  } catch {
    return false;
  }
}

// Personal website: a full https URL (no host restriction), no userinfo. Used by the form field.
export const websiteUrlSchema = z
  .string()
  .trim()
  .refine(isHttpsUrl, 'Enter a valid https website URL.');

// The socialLinks wire object (values are full https URLs the client built). `.strict()` so an undeclared
// key can't ride along; the backend is authoritative on host rules, this is BFF defense-in-depth.
const httpsUrlSchema = z.string().refine(isHttpsUrl, 'Must be a valid https URL.');
export const socialLinksSchema = z
  .object({
    twitter: httpsUrlSchema.optional(),
    instagram: httpsUrlSchema.optional(),
    website: httpsUrlSchema.optional(),
  })
  .strict();

// ── The PATCH body — ONLY declared keys (forbidNonWhitelisted). Tri-state: absent=unchanged, null=clear,
// value=set. `.strict()` rejects any unknown key. ProfilePatch is DERIVED from the schema (single source),
// so schema and type can't drift. ──
export const profilePatchSchema = z
  .object({
    bio: bioSchema.optional(),
    statement: statementSchema.optional(),
    socialLinks: socialLinksSchema.nullable().optional(),
    profileImageId: z.uuid().nullable().optional(),
  })
  .strict();

export type ProfilePatch = z.infer<typeof profilePatchSchema>;

// ── Avatar image pre-flight gate. `z.instanceof(File)` narrows FormData/DataTransfer entries — never an
// `as File` cast. Size + MIME allowlist (SVG excluded); the backend magic-byte sniff is the real authority. ──
export const profileImageFileSchema = z
  .instanceof(File)
  .refine((f) => f.size > 0, 'This file appears to be empty.')
  .refine((f) => f.size <= PROFILE_IMAGE_MAX_BYTES, 'This image is larger than the 5 MB limit.')
  .refine(
    (f) => (PROFILE_IMAGE_MIME as readonly string[]).includes(f.type),
    'Use a JPEG, PNG or WebP image.',
  );

// ── Pure form transforms (data-loss-critical — unit-tested) ──

// The raw form field values (what the user types). Social platforms are bare handles; website is a full URL.
export type ProfileFormValues = {
  bio: string;
  statement: string;
  twitter: string;
  instagram: string;
  website: string;
};

// Seed the form from a loaded profile — reverses stored URLs back to bare handles (parseHandle), so the
// round-trip is stable and the form doesn't load dirty.
export function profileToFormValues(profile: MeProfile): ProfileFormValues {
  const links = profile.socialLinks;
  const reverse = (url: string | undefined, platform: SocialPlatform): string => {
    if (!url) return '';
    const parsed = parseHandle(url, platform);
    return parsed.ok ? parsed.handle : '';
  };
  return {
    bio: profile.bio ?? '',
    statement: profile.statement ?? '',
    twitter: reverse(links?.twitter, 'twitter'),
    instagram: reverse(links?.instagram, 'instagram'),
    website: links?.website ?? '',
  };
}

// Replace-whole-object: always emit the full socialLinks object built from all three inputs, so clearing ONE
// platform preserves the others. All-empty → null (cleared), never `{}`. Invalid entries are skipped (the
// form gates Save on validity, so this is a backstop).
export function mergeSocialLinks(form: ProfileFormValues): SocialLinks | null {
  const out: SocialLinks = {};
  const twitter = parseHandle(form.twitter, 'twitter');
  if (form.twitter.trim() !== '' && twitter.ok)
    out.twitter = buildHandleUrl(twitter.handle, 'twitter');
  const instagram = parseHandle(form.instagram, 'instagram');
  if (form.instagram.trim() !== '' && instagram.ok)
    out.instagram = buildHandleUrl(instagram.handle, 'instagram');
  const website = form.website.trim();
  if (website !== '' && isHttpsUrl(website)) out.website = website;
  return Object.keys(out).length > 0 ? out : null;
}

// Canonicalize a stored handle URL so the dirty-compare is HOST-AGNOSTIC: `parseHandle` accepts both `x.com`
// and `twitter.com`, but `buildHandleUrl` always emits `x.com`, so a stored `https://twitter.com/foo` must
// canonicalize to `https://x.com/foo` — otherwise it never equals the rebuilt value and the form loads dirty
// / re-sends socialLinks on every save (#221). Falls back to the raw value for an unparseable stored URL.
function canonicalHandleUrl(url: string, platform: SocialPlatform): string {
  const parsed = parseHandle(url, platform);
  return parsed.ok ? buildHandleUrl(parsed.handle, platform) : url;
}

function socialValueEqual(
  a: string | undefined,
  b: string | undefined,
  platform: SocialPlatform,
): boolean {
  const ca = a ? canonicalHandleUrl(a, platform) : null;
  const cb = b ? canonicalHandleUrl(b, platform) : null;
  return ca === cb;
}

function socialLinksEqual(a: SocialLinks | null, b: SocialLinks | null): boolean {
  return (
    socialValueEqual(a?.twitter, b?.twitter, 'twitter') &&
    socialValueEqual(a?.instagram, b?.instagram, 'instagram') &&
    (a?.website ?? null) === (b?.website ?? null)
  );
}

// Diff the form against the last-saved snapshot → include a key ONLY when it changed. Emptied text field →
// explicit `null` (clear), never `""`. socialLinks goes as the whole rebuilt object (or null). profileImageId
// is NOT part of the text form — the avatar flow owns it via setAvatarAction.
export function buildProfilePatch(form: ProfileFormValues, snapshot: MeProfile): ProfilePatch {
  const patch: ProfilePatch = {};

  const nextBio = form.bio.length > 0 ? form.bio : null;
  if (nextBio !== snapshot.bio) patch.bio = nextBio;

  const nextStatement = form.statement.length > 0 ? form.statement : null;
  if (nextStatement !== snapshot.statement) patch.statement = nextStatement;

  const nextLinks = mergeSocialLinks(form);
  if (!socialLinksEqual(nextLinks, snapshot.socialLinks)) patch.socialLinks = nextLinks;

  return patch;
}
