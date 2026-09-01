import { describe, it, expect } from 'vitest';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { FractionalizeArtworkDto } from '../../../../src/modules/backoffice/artworks/dto/fractionalize-artwork.dto';

const VALID = {
  total_supply: 1_000_000,
  artist_retention_pct: 10,
  treasury_retention_pct: 5,
  artist_lockup_days: 365,
  treasury_lockup_days: 730,
  name: 'Northern Lights Fraction',
  symbol: 'NLIGHT',
};

const errorsFor = (patch: Record<string, unknown>) =>
  validateSync(plainToInstance(FractionalizeArtworkDto, { ...VALID, ...patch }));

describe('FractionalizeArtworkDto', () => {
  it('accepts a valid boundary payload', () => {
    expect(errorsFor({})).toHaveLength(0);
  });

  it('accepts retention percentages summing to exactly 100', () => {
    expect(errorsFor({ artist_retention_pct: 60, treasury_retention_pct: 40 })).toHaveLength(0);
  });

  it('accepts zero lockup and zero retention (no lockup, nothing retained)', () => {
    expect(
      errorsFor({ artist_retention_pct: 0, treasury_retention_pct: 0, artist_lockup_days: 0, treasury_lockup_days: 0 }),
    ).toHaveLength(0);
  });

  // --- negative: supply ---
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['non-integer', 1.5],
  ])('rejects total_supply %s', (_label, total_supply) => {
    expect(errorsFor({ total_supply }).length).toBeGreaterThan(0);
  });

  // --- negative: percentages ---
  it.each([
    ['artist > 100', { artist_retention_pct: 101 }],
    ['treasury negative', { treasury_retention_pct: -1 }],
    ['sum > 100', { artist_retention_pct: 60, treasury_retention_pct: 41 }],
    ['non-integer pct', { artist_retention_pct: 10.5 }],
  ])('rejects %s', (_label, patch) => {
    expect(errorsFor(patch).length).toBeGreaterThan(0);
  });

  // --- negative: lockup ---
  it('rejects negative lockup days', () => {
    expect(errorsFor({ artist_lockup_days: -1 }).length).toBeGreaterThan(0);
  });

  // --- negative/edge: name (SEP-41 metadata spoofing guard) ---
  it.each([
    ['empty', ''],
    ['too long (33)', 'x'.repeat(33)],
    ['zero-width joiner', 'Real\u200dName'],
    ['RTL override', 'Art\u202ekrow'],
    ['control char', 'Art\u0001work'],
  ])('rejects name: %s', (_label, name) => {
    expect(errorsFor({ name }).length).toBeGreaterThan(0);
  });

  it('accepts a unicode-letter name within the printable allowlist', () => {
    expect(errorsFor({ name: "Étude No1 - Sophie's A&B" }).length).toBe(0);
  });

  // --- negative/edge: symbol ---
  it.each([
    ['lowercase', 'nlight'],
    ['too short (1)', 'N'],
    ['too long (13)', 'ABCDEFGHIJKLM'],
    ['symbol chars', 'NL-1'],
  ])('rejects symbol: %s', (_label, symbol) => {
    expect(errorsFor({ symbol }).length).toBeGreaterThan(0);
  });
});
