import type {
  RotationItem,
  RotationBeginData,
  RotationSubmitData,
  RotationStatusData,
  SignedRotationItem,
} from '@/lib/types/api';

export const SOURCE_WALLET_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
export const DEST_WALLET_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
export const DEST_ADDRESS = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
export const ROTATION_ID = 'bbbb2222-0000-0000-0000-000000000001';

export const fakeFractionItemA: RotationItem = {
  itemId: 'aaaa1111-0000-0000-0000-000000000001',
  tokenContract: 'CAFRACTIONA000000000000000000000000000000000000000000000',
  amountScaled: '500',
  decimals: 0,
  displayName: 'Fraction A',
  challenge: 'Y2hhbGxlbmdlLWE=',
  expiresAtLedger: 1234567,
  credentialId: 'Y3JlZElkLWE=',
  rpId: 'tove.io',
  transports: 'internal',
};

export const fakeFractionItemB: RotationItem = {
  itemId: 'aaaa1111-0000-0000-0000-000000000002',
  tokenContract: 'CAFRACTIONB000000000000000000000000000000000000000000000',
  amountScaled: '120',
  decimals: 0,
  displayName: 'Fraction B',
  challenge: 'Y2hhbGxlbmdlLWI=',
  expiresAtLedger: 1234567,
  credentialId: 'Y3JlZElkLWI=',
  rpId: 'tove.io',
  transports: 'internal',
};

export const fakeRotateInitiate200: RotationBeginData = {
  rotationId: ROTATION_ID,
  status: 'pending',
  destinationWalletId: DEST_WALLET_ID,
  items: [fakeFractionItemA, fakeFractionItemB],
};

export const fakeSignedItems: SignedRotationItem[] = [
  {
    itemId: fakeFractionItemA.itemId,
    authenticatorData: 'YQ==',
    clientDataJSON: 'Yw==',
    signature: 'cw==',
  },
];

export const fakeRotateSubmit200: RotationSubmitData = {
  rotationId: ROTATION_ID,
  status: 'submitting',
  items: [
    {
      itemId: fakeFractionItemA.itemId,
      tokenContract: fakeFractionItemA.tokenContract,
      amountScaled: fakeFractionItemA.amountScaled,
      status: 'confirmed',
      txHash: 'abc123',
      ledger: 1234570,
    },
  ],
};

export const fakeRotateStatusConfirmed: RotationStatusData = {
  rotationId: ROTATION_ID,
  state: 'confirmed',
  destinationWalletId: DEST_WALLET_ID,
  destinationAddress: DEST_ADDRESS,
  items: [
    {
      itemId: fakeFractionItemA.itemId,
      tokenContract: fakeFractionItemA.tokenContract,
      amountScaled: fakeFractionItemA.amountScaled,
      status: 'confirmed',
      txHash: 'abc123',
      ledger: 1234570,
    },
    {
      itemId: fakeFractionItemB.itemId,
      tokenContract: fakeFractionItemB.tokenContract,
      amountScaled: fakeFractionItemB.amountScaled,
      // A recovered item confirmed WITHOUT a tx hash (drained balance = landed) — must still parse.
      status: 'confirmed',
      txHash: null,
      ledger: null,
    },
  ],
};

export const fakeRotateStatusNone = {
  rotationId: '',
  state: 'none',
  destinationWalletId: '',
  destinationAddress: '',
  items: [],
};

export const fakeRotateCancel200 = { canceledId: ROTATION_ID };

// Error bodies (backend keys errors on `errorCode`).
export const fakeBlockedByLockup422 = {
  statusCode: 422,
  errorCode: 'ROTATION_BLOCKED_BY_LOCKUP',
  message: 'Wallet rotation request failed',
  lockupExpiresAt: '2026-11-04T00:00:00.000Z',
};
export const fakeNotPrimary409 = {
  errorCode: 'ROTATION_DESTINATION_NOT_PRIMARY',
  message: 'Destination is not the current primary.',
};
export const fakeConflict409 = { errorCode: 'ROTATION_CONFLICT', message: 'Already active.' };
export const fakeNothingToTransfer422 = {
  errorCode: 'ROTATION_NOTHING_TO_TRANSFER',
  message: 'No non-zero fractions.',
};
export const fakeNotWhitelisted422 = {
  errorCode: 'RECIPIENT_NOT_WHITELISTED',
  message: 'Destination not allowlisted.',
};
export const fakeCannotCancel409 = {
  errorCode: 'ROTATION_CANNOT_CANCEL',
  message: 'An item is in-flight.',
};
