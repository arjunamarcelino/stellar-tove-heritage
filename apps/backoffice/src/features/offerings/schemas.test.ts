import { describe, it, expect } from 'vitest';

import {
  approveResponseSchema,
  offeringDetailSchema,
  offeringListItemSchema,
  paginatedOfferingsSchema,
} from './schemas';

const C_ADDR = 'C' + 'A'.repeat(55);

const listItem = {
  id: 'o1',
  artworkId: 'a1',
  status: 'planned',
  lowPriceStroops: '1000000',
  highPriceStroops: '5000000',
  publicFloat: '800000',
  windowOpenAt: '2026-09-01T00:00:00.000Z',
  windowCloseAt: '2026-09-08T00:00:00.000Z',
  attestedArtistAddress: null,
  escrow: { deployStatus: null, contractAddress: null },
  approvals: { count: 1, threshold: 2, youApproved: false },
};

const detail = {
  ...listItem,
  status: 'approved',
  escrow: {
    deployStatus: 'deployed',
    contractAddress: C_ADDR,
    deployLedger: '5551234',
    approvedAt: '2026-08-19T10:22:31.000Z',
  },
  approvals: { count: 2, threshold: 2, signers: ['sub1', 'sub2'] },
};

describe('offering schemas', () => {
  it('parses a list item and keeps money as strings (positive)', () => {
    const parsed = offeringListItemSchema.parse(listItem);
    expect(parsed.lowPriceStroops).toBe('1000000');
    expect(typeof parsed.publicFloat).toBe('string');
    expect(parsed.approvals.youApproved).toBe(false);
  });

  it('parses the paginated envelope with optional hasNextPage (positive)', () => {
    const env = paginatedOfferingsSchema.parse({
      data: [listItem],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    expect(env.data).toHaveLength(1);
  });

  it('parses a detail with signers, not youApproved (positive)', () => {
    const parsed = offeringDetailSchema.parse(detail);
    expect(parsed.approvals.signers).toEqual(['sub1', 'sub2']);
    expect(parsed.escrow.deployLedger).toBe('5551234');
  });

  it('REJECTS a numeric money field — no silent JSON-number coercion (negative)', () => {
    expect(() => offeringListItemSchema.parse({ ...listItem, lowPriceStroops: 1000000 })).toThrow();
    expect(() => offeringListItemSchema.parse({ ...listItem, publicFloat: '12.5' })).toThrow();
  });

  it('preserves a > 2^53 i128 string exactly (edge)', () => {
    const big = '170141183460469231731687303715884105727'; // ~ i128 max
    const parsed = offeringListItemSchema.parse({ ...listItem, highPriceStroops: big });
    expect(parsed.highPriceStroops).toBe(big);
  });

  it('is lenient about unknown additive fields on responses (edge)', () => {
    const parsed = offeringDetailSchema.parse({ ...detail, extraServerField: 'x' });
    expect('extraServerField' in parsed).toBe(false);
  });

  it('does NOT throw on a deployed escrow whose address is not yet valid (poll-target safety)', () => {
    expect(() =>
      offeringDetailSchema.parse({
        ...detail,
        escrow: { deployStatus: 'deployed', contractAddress: null, deployLedger: null, approvedAt: null },
      }),
    ).not.toThrow();
  });

  it('parses a 202 approve response (positive)', () => {
    const parsed = approveResponseSchema.parse({
      offeringId: 'o1',
      status: 'planned',
      approvals: { count: 1, threshold: 2, youApproved: true, signers: ['sub1'] },
      escrow: { deployStatus: null, contractAddress: null },
    });
    expect(parsed.approvals.count).toBe(1);
  });
});
