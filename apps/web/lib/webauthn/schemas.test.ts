import { describe, it, expect } from 'vitest';
import { emailSchema } from '@/lib/webauthn/schemas';

describe('emailSchema', () => {
  it('trims and lowercases before validating', () => {
    const result = emailSchema.safeParse('  Leonardo@Example.COM  ');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('leonardo@example.com');
  });

  it('rejects an invalid email', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });

  it('rejects an over-long email (>254 chars)', () => {
    const long = `${'a'.repeat(250)}@x.com`;
    expect(emailSchema.safeParse(long).success).toBe(false);
  });
});
