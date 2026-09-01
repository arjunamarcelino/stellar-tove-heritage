import { z } from 'zod';

// Internal artwork lifecycle (backend `ArtworkStatus`). `verified` is the only fractionalizable state.
export const artworkStatusSchema = z.enum([
  'verified',
  'published',
  'fractionalizing',
  'fractionalized',
]);
export type ArtworkStatus = z.infer<typeof artworkStatusSchema>;

// The deploy-status poll endpoint DOES surface `failed`.
export const fractionalizationStatusValueSchema = z.enum(['deploying', 'deployed', 'failed']);
export type FractionalizationStatusValue = z.infer<typeof fractionalizationStatusValueSchema>;

// Read models (list/detail) project the ACTIVE fraction contract only — derived from the poll superset so
// the two domains can't drift (never `failed`).
export const activeFractionStatusSchema = fractionalizationStatusValueSchema.exclude(['failed']);
export type ActiveFractionStatus = z.infer<typeof activeFractionStatusSchema>;

// Single source of truth for "stop polling".
export const TERMINAL_FRACTION_STATUSES: readonly FractionalizationStatusValue[] = [
  'deployed',
  'failed',
];

export const fractionContractSummarySchema = z.object({
  status: activeFractionStatusSchema,
  tokenAddress: z.string().nullable(),
});
export type FractionContractSummary = z.infer<typeof fractionContractSummarySchema>;

export const fractionContractDetailSchema = z.object({
  id: z.string(),
  status: activeFractionStatusSchema,
  tokenAddress: z.string().nullable(),
  totalSupply: z.string(),
  artistRetentionPct: z.number(),
  treasuryRetentionPct: z.number(),
  artistLockupDays: z.number(),
  treasuryLockupDays: z.number(),
  tokenName: z.string(),
  tokenSymbol: z.string(),
});
export type FractionContractDetail = z.infer<typeof fractionContractDetailSchema>;

export const artworkListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  artistName: z.string().nullable(),
  artistHandle: z.string().nullable(),
  primaryImageUrl: z.string().nullable(),
  status: artworkStatusSchema,
  fractionContract: fractionContractSummarySchema.nullable(),
});
export type ArtworkListItem = z.infer<typeof artworkListItemSchema>;

export const artworkDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  year: z.number().nullable(),
  medium: z.string().nullable(),
  dimensions: z.string().nullable(),
  artistUserId: z.string(),
  artistName: z.string().nullable(),
  artistHandle: z.string().nullable(),
  primaryImageUrl: z.string().nullable(),
  status: artworkStatusSchema,
  fractionContract: fractionContractDetailSchema.nullable(),
});
export type ArtworkDetail = z.infer<typeof artworkDetailSchema>;

export const paginatedArtworksSchema = z.object({
  data: z.array(artworkListItemSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});
export type PaginatedArtworks = z.infer<typeof paginatedArtworksSchema>;

// Poll response (backend `FractionalizationResponseDto`) — lenient about extra fields (no `.strict()`), but
// validates the criticals: a `deployed` status must carry a valid contract StrKey (else the panel would
// build a broken/misleading explorer link).
export const fractionalizationStatusSchema = z
  .object({
    artworkId: z.string(),
    fractionContractId: z.string(),
    status: fractionalizationStatusValueSchema,
    tokenAddress: z.string().nullable(),
  })
  .refine((v) => v.status !== 'deployed' || (v.tokenAddress !== null && /^C[A-Z2-7]{55}$/.test(v.tokenAddress)), {
    message: 'A deployed fraction contract must have a valid contract address',
    path: ['tokenAddress'],
  });
export type FractionalizationStatus = z.infer<typeof fractionalizationStatusSchema>;

// Belt-and-suspenders: the `name` allowlist regex below already rejects these (none are letters/numbers
// or the listed punctuation), but this explicit guard documents intent and survives an allowlist change.
const INVISIBLE_CHARS = /[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/;

/**
 * Fractionalize request body. Mirrors the backend DTO (integers, retention sum <= 100). `name`/`symbol`
 * become on-chain SEP-41 metadata, so `name` is an allowlist + an extra invisible-char guard.
 */
export const fractionalizeFormSchema = z
  .object({
    totalSupply: z.number().int().min(1).max(1_000_000),
    artistRetentionPct: z.number().int().min(0).max(100),
    treasuryRetentionPct: z.number().int().min(0).max(100),
    artistLockupDays: z.number().int().min(0).max(3650),
    treasuryLockupDays: z.number().int().min(0).max(3650),
    name: z
      .string()
      .regex(/^[\p{L}\p{N} .,'&:-]{1,32}$/u, 'Name must be 1–32 printable characters')
      .refine((v) => !INVISIBLE_CHARS.test(v), 'Name contains disallowed invisible characters')
      // NFC-normalize so the minted SEP-41 metadata is canonical (preview == minted bytes). Whole-script
      // homograph collisions remain an accepted risk, mitigated by the verbatim mint preview.
      .transform((v) => v.normalize('NFC')),
    symbol: z.string().regex(/^[A-Z0-9]{2,12}$/, 'Symbol must be 2–12 uppercase letters/numbers'),
  })
  .strict()
  .refine((v) => v.artistRetentionPct + v.treasuryRetentionPct <= 100, {
    message: 'Artist + treasury retention must not exceed 100%',
    path: ['treasuryRetentionPct'],
  });
export type FractionalizeFormData = z.infer<typeof fractionalizeFormSchema>;

/** public_float = total_supply × (1 − artist% − treasury%), floored to a non-negative integer. */
export function computePublicFloat(
  totalSupply: number,
  artistPct: number,
  treasuryPct: number,
): number | null {
  if (![totalSupply, artistPct, treasuryPct].every(Number.isFinite)) return null;
  if (artistPct + treasuryPct > 100) return null;
  return Math.floor(totalSupply * (1 - artistPct / 100 - treasuryPct / 100));
}
