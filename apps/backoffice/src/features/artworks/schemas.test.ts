import { describe, it, expect } from 'vitest';
import {
  artworkDetailSchema,
  artworkListItemSchema,
  computePublicFloat,
  fractionalizationStatusSchema,
  fractionalizeFormSchema,
  paginatedArtworksSchema,
} from './schemas';

const validFractionalize = {
  totalSupply: 100,
  artistRetentionPct: 10,
  treasuryRetentionPct: 5,
  artistLockupDays: 365,
  treasuryLockupDays: 730,
  name: 'Northern Lights',
  symbol: 'NLIGHT',
};

const listItem = {
  id: 'a1',
  title: 'Northern Lights',
  artistName: 'Ada',
  artistHandle: 'ada',
  primaryImageUrl: null,
  status: 'verified' as const,
  fractionContract: null,
};

describe('artworkListItemSchema', () => {
  it('parses a valid verified row with no contract (positive)', () => {
    expect(artworkListItemSchema.parse(listItem)).toEqual(listItem);
  });

  it('parses a fractionalized row with an active contract (edge)', () => {
    const row = {
      ...listItem,
      status: 'fractionalized' as const,
      fractionContract: { status: 'deployed' as const, tokenAddress: 'C'.padEnd(56, 'A') },
    };
    expect(artworkListItemSchema.parse(row).fractionContract?.status).toBe('deployed');
  });

  it('rejects an unknown status and a failed contract status (negative)', () => {
    expect(() => artworkListItemSchema.parse({ ...listItem, status: 'draft' })).toThrow();
    // read models are active-only; `failed` must never appear here
    expect(() =>
      artworkListItemSchema.parse({
        ...listItem,
        fractionContract: { status: 'failed', tokenAddress: null },
      }),
    ).toThrow();
  });
});

describe('artworkDetailSchema', () => {
  it('parses full canonical metadata (positive)', () => {
    const detail = {
      id: 'a1',
      title: 'Northern Lights',
      year: 2021,
      medium: 'Oil',
      dimensions: '10x10',
      artistUserId: 'u1',
      artistName: 'Ada',
      artistHandle: 'ada',
      primaryImageUrl: null,
      status: 'verified' as const,
      fractionContract: null,
    };
    expect(artworkDetailSchema.parse(detail)).toEqual(detail);
  });

  it('rejects a missing required field (negative)', () => {
    expect(() => artworkDetailSchema.parse({ id: 'a1', title: 'x' })).toThrow();
  });
});

describe('paginatedArtworksSchema', () => {
  it('parses the { data, meta } envelope (positive)', () => {
    const page = {
      data: [listItem],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    expect(paginatedArtworksSchema.parse(page).meta.total).toBe(1);
  });
});

describe('fractionalizationStatusSchema (poll)', () => {
  it('accepts deploying/deployed/failed with nullable address (positive + edge)', () => {
    const base = { artworkId: 'a1', fractionContractId: 'f1', tokenAddress: null };
    expect(fractionalizationStatusSchema.parse({ ...base, status: 'deploying' }).status).toBe(
      'deploying',
    );
    expect(fractionalizationStatusSchema.parse({ ...base, status: 'failed' }).status).toBe('failed');
    expect(
      fractionalizationStatusSchema.parse({
        artworkId: 'a1',
        fractionContractId: 'f1',
        status: 'deployed',
        tokenAddress: 'C'.padEnd(56, 'A'),
      }).tokenAddress,
    ).toBe('C'.padEnd(56, 'A'));
  });

  it('rejects an out-of-enum status (negative)', () => {
    expect(() =>
      fractionalizationStatusSchema.parse({
        artworkId: 'a1',
        fractionContractId: 'f1',
        status: 'pending',
        tokenAddress: null,
      }),
    ).toThrow();
  });
});

describe('fractionalizeFormSchema', () => {
  it('accepts valid input including sum == 100 (positive + edge)', () => {
    expect(fractionalizeFormSchema.safeParse(validFractionalize).success).toBe(true);
    expect(
      fractionalizeFormSchema.safeParse({
        ...validFractionalize,
        artistRetentionPct: 50,
        treasuryRetentionPct: 50,
      }).success,
    ).toBe(true);
  });

  it('rejects sum > 100 with the error at the treasury path (negative)', () => {
    const result = fractionalizeFormSchema.safeParse({
      ...validFractionalize,
      artistRetentionPct: 60,
      treasuryRetentionPct: 50,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('treasuryRetentionPct'))).toBe(true);
    }
  });

  it('rejects bad symbol, non-integer supply, and unknown fields (negative/edge)', () => {
    expect(fractionalizeFormSchema.safeParse({ ...validFractionalize, symbol: 'nl' }).success).toBe(
      false,
    );
    expect(
      fractionalizeFormSchema.safeParse({ ...validFractionalize, totalSupply: 1.5 }).success,
    ).toBe(false);
    // .strict() rejects unknown keys so they can't reach the on-chain deploy
    expect(fractionalizeFormSchema.safeParse({ ...validFractionalize, evil: 1 }).success).toBe(
      false,
    );
  });

  it('rejects a zero-width character in the token name (negative)', () => {
    expect(
      fractionalizeFormSchema.safeParse({ ...validFractionalize, name: 'Ada\u200BArt' }).success,
    ).toBe(false);
  });

  it('NFC-normalizes the token name (072)', () => {
    // U+212B (ANGSTROM SIGN, a letter) normalizes to U+00C5 (\u00C5) under NFC.
    const parsed = fractionalizeFormSchema.parse({ ...validFractionalize, name: '\u212BngstromArt' });
    expect(parsed.name).toBe('\u00C5ngstromArt');
    expect(parsed.name).toBe(parsed.name.normalize('NFC'));
  });
});

describe('computePublicFloat', () => {
  it('floors supply × (1 − a% − t%) (positive + edge)', () => {
    expect(computePublicFloat(100, 10, 5)).toBe(85);
    expect(computePublicFloat(1000, 0, 0)).toBe(1000);
    expect(computePublicFloat(100, 50, 50)).toBe(0);
  });

  it('returns null when sum > 100 or inputs are not finite (negative)', () => {
    expect(computePublicFloat(100, 60, 50)).toBeNull();
    expect(computePublicFloat(Number.NaN, 10, 5)).toBeNull();
  });
});
