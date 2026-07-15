import { describe, it, expect } from 'vitest';
import { publicKeySchema, makeTargetAddressSchema } from '@/lib/wallet/schemas';

const OWN = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const OTHER = 'GBRHXSWJPTNSHCLLX2QPA7THILWIY3BKJLPFI4GYJLDNPQRAI2ROOBME';

describe('publicKeySchema', () => {
  it('accepts a valid 56-char G-address', () => {
    expect(publicKeySchema.safeParse(OWN).success).toBe(true);
  });

  it('rejects muxed M-addresses and federation strings for free', () => {
    expect(publicKeySchema.safeParse(`M${OWN.slice(1)}`).success).toBe(false);
    expect(publicKeySchema.safeParse('leo*toveheritage.com').success).toBe(false);
  });
});

describe('makeTargetAddressSchema', () => {
  const schema = makeTargetAddressSchema(OWN);

  it('accepts a valid destination that differs from the wallet address', () => {
    expect(schema.safeParse(OTHER).success).toBe(true);
  });

  it("rejects the wallet's own address (no self-export)", () => {
    const result = schema.safeParse(OWN);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Enter an address other than this wallet');
    }
  });

  it('still rejects malformed addresses (inherits publicKeySchema)', () => {
    expect(schema.safeParse('not-an-address').success).toBe(false);
  });
});
