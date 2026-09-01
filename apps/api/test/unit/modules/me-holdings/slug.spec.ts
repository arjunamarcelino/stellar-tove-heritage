import { describe, it, expect } from 'vitest';
import { slugFallback } from '../../../../src/common/utils/slug.util';

const ID = '0000000a-0001-4000-8000-0000000a0001';
const SUFFIX = '0000000a'; // first 8 hex of the id with dashes removed

describe('slugFallback', () => {
  it('kebab-cases a normal title and appends the id suffix', () => {
    expect(slugFallback('Northern Lights', ID)).toBe(`northern-lights-${SUFFIX}`);
  });

  it('trims leading/trailing separators (no leading or double hyphen)', () => {
    expect(slugFallback('#Midnight', ID)).toBe(`midnight-${SUFFIX}`);
    expect(slugFallback('Sunset!', ID)).toBe(`sunset-${SUFFIX}`);
    expect(slugFallback('  Fjord  Study  ', ID)).toBe(`fjord-study-${SUFFIX}`);
  });

  it('falls back to "artwork" for punctuation/Unicode-only titles', () => {
    expect(slugFallback('你好世界', ID)).toBe(`artwork-${SUFFIX}`);
    expect(slugFallback('!!!', ID)).toBe(`artwork-${SUFFIX}`);
  });

  it('never emits a leading, trailing, or doubled hyphen in the stem', () => {
    const slug = slugFallback('  ***Hello***  World??  ', ID);
    expect(slug).toBe(`hello-world-${SUFFIX}`);
    expect(slug.startsWith('-')).toBe(false);
    expect(slug).not.toContain('--');
  });
});
