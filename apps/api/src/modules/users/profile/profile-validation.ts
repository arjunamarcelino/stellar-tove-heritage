import { FieldError } from '@common/http/fail-http';
import { ProfilePatch } from './profile.types';
import {
  SocialLinks,
  SocialLinkPlatform,
  SOCIAL_LINK_PLATFORMS,
  SOCIAL_LINK_HOST_PATTERNS,
  SOCIAL_LINK_MAX_URL_LENGTH,
  BIO_MAX_LENGTH,
  STATEMENT_MAX_LENGTH,
} from './constants/social-links.constant';

/**
 * Pure validation for `PATCH /me` (TOV-30). Reads from the RAW request body (not a DTO instance) so
 * presence detection is reliable under `useDefineForClassFields`/SWC: an absent key leaves the column
 * unchanged; an explicit `null` (or empty string) clears it. Returns a column-scoped {@link ProfilePatch}
 * plus any field-level errors (dotted paths like `socialLinks.twitter`) for a 422 `VALIDATION_FAILED`.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True if `s` contains a C0/C1 control char, a zero-width/bidi format char, or a BOM — rejected in text
 * fields and URLs to prevent display-spoofing and stored-payload tricks on the public collector profile.
 * Implemented over char codes (no control chars in source, no regex).
 */
function hasControlChars(s: string): boolean {
  // Iterate CODE POINTS (for…of) so astral chars like the U+E0000 tag block are seen whole.
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (
      c <= 0x1f || // C0 controls
      (c >= 0x7f && c <= 0x9f) || // DEL + C1 controls
      c === 0x00ad || // soft hyphen
      c === 0x061c || // Arabic letter mark (bidi)
      (c >= 0x200b && c <= 0x200f) || // zero-width + LRM/RLM
      (c >= 0x2028 && c <= 0x2029) || // line / paragraph separator
      (c >= 0x202a && c <= 0x202e) || // bidi overrides/embeddings
      (c >= 0x2060 && c <= 0x2064) || // word joiner + invisible operators
      (c >= 0x2066 && c <= 0x2069) || // bidi isolates
      c === 0xfeff || // BOM / zero-width no-break space
      (c >= 0xe0000 && c <= 0xe007f) // tag characters (hidden-text spoofing)
    ) {
      return true;
    }
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface Ctx {
  patch: ProfilePatch;
  errors: FieldError[];
}

/** Trim + reject control chars + length-cap a text field; '' or null → clear (null). */
function applyText(ctx: Ctx, field: 'bio' | 'statement', value: unknown, maxLength: number): void {
  if (value === null) {
    ctx.patch[field] = null;
    return;
  }
  if (typeof value !== 'string') {
    ctx.errors.push({ field, message: `${field} must be a string or null` });
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    ctx.patch[field] = null; // empty clears
    return;
  }
  if (hasControlChars(trimmed)) {
    ctx.errors.push({ field, message: `${field} must not contain control characters` });
    return;
  }
  if (trimmed.length > maxLength) {
    ctx.errors.push({ field, message: `${field} must be at most ${maxLength} characters` });
    return;
  }
  ctx.patch[field] = trimmed;
}

function applyOneSocialLink(
  ctx: Ctx,
  result: SocialLinks,
  platform: SocialLinkPlatform,
  value: unknown,
): void {
  if (value === null || value === '') return; // per-platform clear/omit
  if (typeof value !== 'string') {
    ctx.errors.push({ field: `socialLinks.${platform}`, message: `${platform} must be a string` });
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return;
  if (hasControlChars(trimmed) || trimmed.length > SOCIAL_LINK_MAX_URL_LENGTH) {
    ctx.errors.push({ field: `socialLinks.${platform}`, message: `${platform} is not a valid URL` });
    return;
  }
  if (!SOCIAL_LINK_HOST_PATTERNS[platform].test(trimmed)) {
    ctx.errors.push({
      field: `socialLinks.${platform}`,
      message:
        platform === 'website'
          ? 'website must be a valid https URL'
          : `${platform} must be a valid https URL on the ${platform} domain`,
    });
    return;
  }
  result[platform] = trimmed;
}

function applySocialLinks(ctx: Ctx, value: unknown): void {
  if (value === null) {
    ctx.patch.socialLinks = null;
    return;
  }
  if (!isPlainObject(value)) {
    ctx.errors.push({ field: 'socialLinks', message: 'socialLinks must be an object' });
    return;
  }
  const platforms: readonly string[] = SOCIAL_LINK_PLATFORMS;
  for (const key of Object.keys(value)) {
    if (!platforms.includes(key)) {
      ctx.errors.push({ field: `socialLinks.${key}`, message: `${key} is not a supported platform` });
    }
  }
  const result: SocialLinks = {};
  for (const platform of SOCIAL_LINK_PLATFORMS) {
    if (platform in value) applyOneSocialLink(ctx, result, platform, value[platform]);
  }
  // Replace-whole-object: an object that reduces to nothing clears the field (stored NULL).
  ctx.patch.socialLinks = Object.keys(result).length > 0 ? result : null;
}

function applyProfileImageId(ctx: Ctx, value: unknown): void {
  if (value === null) {
    ctx.patch.profileImageId = null;
    return;
  }
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    ctx.errors.push({ field: 'profileImageId', message: 'profileImageId must be a UUID or null' });
    return;
  }
  ctx.patch.profileImageId = value;
}

export function validateAndBuildPatch(body: Record<string, unknown>): {
  patch: ProfilePatch;
  errors: FieldError[];
} {
  const ctx: Ctx = { patch: {}, errors: [] };
  if (!isPlainObject(body)) {
    // Self-contained 422 (not a body-parser-dependent 500) if the top-level body isn't a JSON object.
    return { patch: {}, errors: [{ field: 'body', message: 'body must be a JSON object' }] };
  }
  if ('bio' in body) applyText(ctx, 'bio', body.bio, BIO_MAX_LENGTH);
  if ('statement' in body) applyText(ctx, 'statement', body.statement, STATEMENT_MAX_LENGTH);
  if ('socialLinks' in body) applySocialLinks(ctx, body.socialLinks);
  if ('profileImageId' in body) applyProfileImageId(ctx, body.profileImageId);
  return ctx;
}
