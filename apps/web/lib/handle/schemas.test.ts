import { describe, it, expect } from 'vitest';
import { handleSchema } from '@/lib/handle/schemas';

function firstMessage(input: string): string | undefined {
  const result = handleSchema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe('handleSchema', () => {
  it('accepts valid handles across the allowed charset and length bounds', () => {
    for (const ok of [
      'jane',
      'Maya',
      'jane_doe',
      'a-b',
      'a.b',
      'MixedCase99',
      'abc',
      'a'.repeat(24),
    ]) {
      expect(handleSchema.safeParse(ok).success, ok).toBe(true);
    }
  });

  it('preserves casing (does not lowercase) and trims the ends', () => {
    expect(handleSchema.parse('Maya')).toBe('Maya');
    expect(handleSchema.parse('  Maya  ')).toBe('Maya');
  });

  it('rejects out-of-range lengths with a length message', () => {
    expect(firstMessage('ab')).toMatch(/at least 3/i);
    expect(firstMessage('a'.repeat(25))).toMatch(/24 characters or fewer/i);
    expect(handleSchema.safeParse('').success).toBe(false);
  });

  it('rejects a leading non-letter', () => {
    for (const bad of ['1jane', '_jane', '.jane', '-jane']) {
      expect(handleSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('rejects a trailing separator', () => {
    for (const bad of ['jane_', 'jane.', 'jane-']) {
      expect(handleSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('rejects consecutive separators', () => {
    for (const bad of ['a--b', 'a..b', 'a-.b', 'a._b']) {
      expect(handleSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('rejects internal whitespace, CRLF, tabs, and Unicode separators', () => {
    for (const bad of ['ja ne', 'ja\tne', 'ja\nne', 'ja\r\nne', 'ja ne', 'ja ne']) {
      expect(handleSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('rejects disallowed punctuation', () => {
    for (const bad of ['jane!', 'ja@ne', 'ja/ne', 'ja#ne']) {
      expect(handleSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});
