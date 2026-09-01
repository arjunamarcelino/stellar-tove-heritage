/**
 * Social links + text-field validation constants (TOV-30, FR-01.09).
 *
 * `social_links` is stored as a jsonb object on `users` with replace-whole-object semantics. Each platform
 * value must be an https URL; twitter/instagram are host-allowlisted (catches wrong-platform pastes). Host
 * regexes are END-ANCHORED and reject whitespace so a trailing-newline stored-payload can't sneak through;
 * ProfileService additionally trims and rejects control/bidi characters before these run.
 */
export interface SocialLinks {
  twitter?: string;
  instagram?: string;
  website?: string;
}

export const SOCIAL_LINK_PLATFORMS = ['twitter', 'instagram', 'website'] as const;
export type SocialLinkPlatform = (typeof SOCIAL_LINK_PLATFORMS)[number];

export const SOCIAL_LINK_MAX_URL_LENGTH = 2048;

// `website` accepts any https URL (display-only). SECURITY: these values are NEVER fetched server-side — if
// a future feature ever unfurls/previews them, it MUST go through an egress allowlist (deny RFC1918 / link-
// local) to avoid SSRF, and the FE must render hrefs with rel="noopener noreferrer nofollow ugc".
export const SOCIAL_LINK_HOST_PATTERNS: Readonly<Record<SocialLinkPlatform, RegExp>> = {
  twitter: /^https:\/\/(www\.)?(x\.com|twitter\.com)\/\S+$/i,
  instagram: /^https:\/\/(www\.)?instagram\.com\/\S+$/i,
  website: /^https:\/\/\S+$/i,
};

export const BIO_MAX_LENGTH = 300;
export const STATEMENT_MAX_LENGTH = 500;
