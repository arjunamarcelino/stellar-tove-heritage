// Shared fixtures for the RFQ create UI (TOV-173 / FR-06.01). fraction_count 100 × max_price 150,000,000
// stroops (= 15 USDC/fraction) → required 15,000,000,000 stroops (= 1,500 USDC). Foundation-owned; downstream
// tests add LOCAL fixtures rather than editing this file.

import type { Rfq, RfqInput } from '@/lib/types/api';

export const ARTWORK_ID = 'a1230000-0000-4000-8000-000000000001';
export const RFQ_ID = '7a9c0000-0000-4000-8000-000000000001';
export const IDEM_KEY = '1de00000-0000-4000-8000-000000000001';

// The 201 wire (camelCase — the house api/v1 convention, backend todo #352) as the backend returns it — the
// service parses this. Carries the internal ids (collectorSub, fractionContractId, createdAt) that the mapper
// intentionally DROPS.
export const rfqWire = {
  id: RFQ_ID,
  collectorSub: '1f2e0000-0000-4000-8000-000000000001',
  artworkId: ARTWORK_ID,
  fractionContractId: 'c4d20000-0000-4000-8000-000000000001',
  fractionCount: '100',
  maxPricePerFractionStroops: '150000000',
  status: 'open',
  expiresAt: '2026-08-24T12:00:00.000Z',
  createdAt: '2026-08-21T12:00:00.000Z',
} as const;

// The 201 wire WITH an advisory balance warning (required = 150000000 × 100 = 15,000,000,000).
export const rfqWireWithWarning = {
  ...rfqWire,
  balanceWarning: {
    requiredStroops: '15000000000',
    availableStroops: '5000000000',
  },
} as const;

// The mapped domain object — ONLY the fields the confirmation renders (internal ids dropped).
export const rfq: Rfq = {
  id: RFQ_ID,
  fractionCount: '100',
  maxPricePerFractionStroops: '150000000',
  status: 'open',
  expiresAt: '2026-08-24T12:00:00.000Z',
};

export const rfqWithWarning: Rfq = {
  ...rfq,
  balanceWarning: { requiredStroops: '15000000000', availableStroops: '5000000000' },
};

// Already past its expiry (for the client-derived "Expired" confirmation state).
export const expiredRfq: Rfq = { ...rfq, expiresAt: '2020-01-01T00:00:00.000Z' };

// The client's create input (artworkId is passed positionally, not on RfqInput).
export const rfqInput: RfqInput = {
  fractionCount: 100,
  maxPricePerFractionStroops: '150000000',
  expiryHours: 72,
};
