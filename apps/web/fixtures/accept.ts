// Shared fixtures for the quote-acceptance UI (TOV-178 / FR-06.04). Trade: fractionCount 500 ×
// pricePerFractionStroops 20,000,000 (= 2 USDC) → gross 10,000,000,000 stroops (= 1,000 USDC). Fees 1.5% + 1.5%
// → seller nets 9,700,000,000; platform 150,000,000; royalty 150,000,000 (sums to gross). Foundation-owned
// (WS-0); downstream tests add LOCAL fixtures rather than editing this file.

import type {
  FeeBreakdown,
  OpenQuote,
  PrepareAcceptData,
  RfqDetail,
  SubmitAcceptInput,
  Trade,
  TradeFailureReason,
} from '@/lib/types/api';

export const RFQ_ID = '4f900000-0000-4000-8000-000000000001';
export const QUOTE_ID = '6c700000-0000-4000-8000-000000000001';
export const ARTWORK_ID = 'a1230000-0000-4000-8000-000000000001';
export const TRADE_ID = '77ade000-0000-4000-8000-000000000001';

export const PRICE_PER_FRACTION = '20000000'; // 2 USDC
export const FRACTION_COUNT = '500';
export const GROSS_STROOPS = '10000000000'; // 1,000 USDC = 500 × 20,000,000
export const SELLER_NET_STROOPS = '9700000000'; // 97%
export const PLATFORM_FEE_STROOPS = '150000000'; // 1.5%
export const ARTIST_ROYALTY_STROOPS = '150000000'; // 1.5%

// ── RFQ detail read (GET /api/v1/marketplace/rfqs/:id) — the one CONFIRMED-shipped endpoint ──

// One open-quote row as the backend returns it (camelCase). `acceptable` is the per-row Accept-CTA gate.
export function openQuoteWire(overrides: Partial<OpenQuote> = {}) {
  return {
    quoteId: QUOTE_ID,
    sellerHandle: '@seller',
    fractionCount: FRACTION_COUNT,
    pricePerFractionStroops: PRICE_PER_FRACTION,
    grossStroops: GROSS_STROOPS,
    validUntil: '2026-08-29T10:00:00.000Z',
    status: 'open',
    acceptable: true,
    ...overrides,
  } as const;
}

export const openQuote: OpenQuote = openQuoteWire();

// A second, cheaper rival quote (price ASC → this one sorts first). Not yet seller-authorized → not acceptable.
export const rivalQuoteWire = openQuoteWire({
  quoteId: '6c700000-0000-4000-8000-000000000002',
  sellerHandle: '@rival',
  pricePerFractionStroops: '18000000',
  grossStroops: '9000000000',
  acceptable: false,
});

export const rfqDetailWire = {
  id: RFQ_ID,
  artworkId: ARTWORK_ID,
  artworkSlug: 'untitled-no-7',
  fractionCount: FRACTION_COUNT,
  maxPricePerFractionStroops: '25000000',
  status: 'open',
  expiresAt: '2026-09-01T10:00:00.000Z',
  createdAt: '2026-08-22T10:00:00.000Z',
  quotes: [rivalQuoteWire, openQuoteWire()],
} as const;

export const rfqDetail: RfqDetail = {
  ...rfqDetailWire,
  status: 'open',
  quotes: [{ ...rivalQuoteWire, status: 'open' }, openQuote],
};

// ── Accept prepare (DRAFT contract) ──

export const feeBreakdownWire = {
  grossStroops: GROSS_STROOPS,
  sellerNetStroops: SELLER_NET_STROOPS,
  platformFeeStroops: PLATFORM_FEE_STROOPS,
  artistRoyaltyStroops: ARTIST_ROYALTY_STROOPS,
} as const;

export const feeBreakdown: FeeBreakdown = { ...feeBreakdownWire };

export const prepareAcceptWire = {
  buyerAuthEntryXdr: 'AAAAAgAAAAB0b3ZlLWJ1eWVyLWF1dGgtZW50cnk',
  challenge: 'a1s2d3f4g5h6j7k8l9z0',
  credentialId: 'AAAABBBBCCCCDDDD',
  transports: 'internal',
  rpId: 'app.toveheritage.com',
  expiresAtLedger: 1234567,
  trade: feeBreakdownWire,
} as const;

export const prepareAcceptData: PrepareAcceptData = {
  buyerAuthEntryXdr: prepareAcceptWire.buyerAuthEntryXdr,
  challenge: prepareAcceptWire.challenge,
  credentialId: prepareAcceptWire.credentialId,
  transports: prepareAcceptWire.transports,
  rpId: prepareAcceptWire.rpId,
  expiresAtLedger: prepareAcceptWire.expiresAtLedger,
  trade: feeBreakdown,
};

// ── Accept submit input (extracted from the WebAuthn assertion + verbatim entry) ──

export const submitAcceptInput: SubmitAcceptInput = {
  quoteId: QUOTE_ID,
  buyerAuthEntryXdr: prepareAcceptData.buyerAuthEntryXdr,
  authenticatorData: 'YXV0aGVudGljYXRvckRhdGE',
  clientDataJSON: 'Y2xpZW50RGF0YUpTT04',
  signature: 'c2lnbmF0dXJl',
};

// A successful WebAuthn assertion result shape (mirrors startPasskeyAssertion success).
export const assertionResponse = {
  status: 'success' as const,
  response: {
    id: 'AAAABBBBCCCCDDDD',
    response: {
      authenticatorData: 'YXV0aGVudGljYXRvckRhdGE',
      clientDataJSON: 'Y2xpZW50RGF0YUpTT04',
      signature: 'c2lnbmF0dXJl',
    },
  },
};

// ── accept/me poll (Trade) ──

export const pendingTradeWire = {
  tradeId: TRADE_ID,
  status: 'pending',
  quoteId: QUOTE_ID,
  count: FRACTION_COUNT,
  grossStroops: GROSS_STROOPS,
  txHash: null,
  settledAt: null,
  failureReason: null,
  registryEventId: null,
  createdAt: '2026-08-22T10:00:30.000Z',
} as const;

export const pendingTrade: Trade = { ...pendingTradeWire, status: 'pending' };

export const settledTradeWire = {
  ...pendingTradeWire,
  status: 'settled',
  txHash: 'b3f1c0de00000000000000000000000000000000000000000000000000000000',
  settledAt: '2026-08-22T10:01:00.000Z',
} as const;

export const settledTrade: Trade = { ...settledTradeWire, status: 'settled' };

export function failedTradeWire(reason: TradeFailureReason = 'buyer_signature_expired') {
  return { ...pendingTradeWire, status: 'failed', failureReason: reason } as const;
}

export function failedTrade(reason: TradeFailureReason = 'buyer_signature_expired'): Trade {
  return { ...pendingTrade, status: 'failed', failureReason: reason };
}

// ── Error bodies (camelCase, `errorCode`) ──

export const insufficientUsdcBody = {
  errorCode: 'ACCEPT_INSUFFICIENT_USDC',
  message: 'insufficient usdc',
  requiredStroops: GROSS_STROOPS,
  availableStroops: '5000000000',
} as const;

export function errorBody(errorCode: string, extra: Record<string, unknown> = {}) {
  return { errorCode, message: 'backend error', ...extra } as const;
}
