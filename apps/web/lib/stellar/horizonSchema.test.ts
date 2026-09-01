import { describe, it, expect } from 'vitest';
import { horizonAccountSchema } from '@/lib/stellar/horizonSchema';

const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

describe('horizonAccountSchema', () => {
  it('parses the fields we read and tolerates extra keys', () => {
    const parsed = horizonAccountSchema.safeParse({
      id: 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O',
      sequence: '12345',
      subentry_count: 1,
      extra_field: 'ignored',
      balances: [
        { asset_type: 'native', balance: '5.0000000', selling_liabilities: '0.0000000' },
        {
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: ISSUER,
          balance: '0.0000000',
          is_authorized: true,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a body missing a required field', () => {
    expect(horizonAccountSchema.safeParse({ sequence: '1', balances: [] }).success).toBe(false);
  });
});
