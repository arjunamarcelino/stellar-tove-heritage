// Shared fixtures for the quote submission UI (TOV-176 / FR-06.03). price 150,000,000 stroops (= 15 USDC) ×
// fractionCount 25 → 375 USDC "you'd receive". Foundation-owned; downstream tests add LOCAL fixtures rather
// than editing this file. Wire is camelCase (the strict api/v1 house convention).

import type { Quote, QuoteInput } from '@/lib/types/api';

export const RFQ_ID = '7a9c0000-0000-4000-8000-000000000001';
export const QUOTE_ID = 'b1e20000-0000-4000-8000-000000000001';
export const IDEM_KEY = '1de00000-0000-4000-8000-000000000001';

// The 201 wire (camelCase) as the backend returns it — the service parses this. Carries the internal ids
// (holderSub, fractionContractId, createdAt) that the mapper intentionally DROPS (egress minimization).
export const quoteWire = {
  id: QUOTE_ID,
  rfqId: RFQ_ID,
  holderSub: '9f770000-0000-4000-8000-000000000001',
  fractionContractId: '77aa0000-0000-4000-8000-000000000001',
  fractionCount: '25',
  pricePerFractionStroops: '150000000',
  validUntil: '2026-08-25T12:00:00.000Z',
  status: 'open',
  createdAt: '2026-08-21T18:30:00.000Z',
} as const;

// The 201 wire WHERE the requested validUntil was capped to the RFQ's earlier expiry (validUntilCapped: true).
export const quoteWireCapped = {
  ...quoteWire,
  validUntil: '2026-08-23T00:00:00.000Z',
  validUntilCapped: true,
} as const;

// The 422 QUOTE_INSUFFICIENT_FREE_BALANCE body — errorCode + the extra count fields (numeric(39,0) strings).
export const insufficientBalanceBody = {
  statusCode: 422,
  error: 'Unprocessable Entity',
  message: 'Insufficient free fraction balance for this quote',
  errorCode: 'QUOTE_INSUFFICIENT_FREE_BALANCE',
  requiredFractionCount: '25',
  freeFractionCount: '5',
} as const;

// The mapped domain object — ONLY the fields the confirmation renders (internal ids dropped).
export const quote: Quote = {
  id: QUOTE_ID,
  rfqId: RFQ_ID,
  fractionCount: '25',
  pricePerFractionStroops: '150000000',
  validUntil: '2026-08-25T12:00:00.000Z',
  status: 'open',
};

export const quoteCapped: Quote = {
  ...quote,
  validUntil: '2026-08-23T00:00:00.000Z',
  validUntilCapped: true,
};

// Already past its validUntil (for the client-derived "Expired" confirmation state).
export const expiredQuote: Quote = { ...quote, validUntil: '2020-01-01T00:00:00.000Z' };

// The client's submit input (rfqId is passed positionally, not on QuoteInput).
export const quoteInput: QuoteInput = {
  fractionCount: 25,
  pricePerFractionStroops: '150000000',
  validUntil: '2026-08-25T12:00:00.000Z',
};
