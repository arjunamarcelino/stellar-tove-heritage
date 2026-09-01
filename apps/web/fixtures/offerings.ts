// Shared fixtures for the offering subscription UI (TOV-157 / FR-05.03). Band [50M, 150M] stroops, price 100M
// stroops (= 10 USDC) × count 10 → escrow 1,000M stroops (= 100 USDC). Foundation-owned (WS-A); downstream
// tests add LOCAL fixtures rather than editing this file.

import type { Bid, Offering, PrepareBidData, SubmitBidInput } from '@/lib/types/api';

export const OFFERING_ID = '0ff30000-0000-4000-8000-000000000001';
export const ARTWORK_ID = 'a1230000-0000-4000-8000-000000000001';

// Wire shape (camelCase) as the backend returns it — services parse this.
export const offeringWire = {
  id: OFFERING_ID,
  artworkId: ARTWORK_ID,
  status: 'opened',
  lowPriceStroops: '50000000',
  highPriceStroops: '150000000',
  publicFloat: '1000000',
  windowOpenAt: '2026-08-20T10:00:00.000Z',
  windowCloseAt: '2026-08-27T10:00:00.000Z',
  escrowContractAddress: 'CBWTOVE00000000000000000000000000000000000000000000000000',
  artworkTitle: 'Untitled No. 7',
  artworkImageUrl:
    'https://vasihtrobeqxooujcryw.supabase.co/storage/v1/object/public/artworks/untitled-7.jpg',
  artistHandle: '@artist',
} as const;

export const offering: Offering = { ...offeringWire, status: 'opened' };

export const prepareWire = {
  txXdr: 'AAAAAgAAAAB0b3ZlLXByZXBhcmUtdHg',
  challenge: 'q1w2e3r4t5y6u7i8o9p0',
  credentialId: 'AAAABBBBCCCCDDDD',
  transports: 'internal',
  rpId: 'app.toveheritage.com',
  escrowAmountStroops: '1000000000',
  price: '100000000',
  count: 10,
  expiresAtLedger: 1234567,
} as const;

export const prepareData: PrepareBidData = {
  txXdr: prepareWire.txXdr,
  challenge: prepareWire.challenge,
  credentialId: prepareWire.credentialId,
  transports: prepareWire.transports,
  rpId: prepareWire.rpId,
  escrowAmountStroops: prepareWire.escrowAmountStroops,
  expiresAtLedger: prepareWire.expiresAtLedger,
};

export const bidWire = {
  id: 'b1d00000-0000-4000-8000-000000000001',
  offeringId: OFFERING_ID,
  price: '100000000',
  count: 10,
  escrowAmountStroops: '1000000000',
  status: 'submitted',
  chainBidId: null,
  escrowTxHash: null,
  createdAt: '2026-08-20T10:00:00.000Z',
} as const;

export const submittedBid: Bid = { ...bidWire, status: 'submitted' };
export const escrowedBid: Bid = {
  ...bidWire,
  status: 'escrowed',
  chainBidId: 1,
  escrowTxHash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
};
export const failedBid: Bid = { ...bidWire, status: 'failed' };

// A WebAuthn assertion, extracted into the submit body shape.
export const submitInput: SubmitBidInput = {
  txXdr: prepareWire.txXdr,
  credentialId: prepareWire.credentialId,
  authenticatorData: 'YXV0aERhdGE',
  clientDataJSON: 'Y2xpZW50RGF0YQ',
  signature: 'c2lnbmF0dXJl',
};
