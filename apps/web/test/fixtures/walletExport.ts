import type {
  WalletSummary,
  ExportItem,
  ExportBeginData,
  ExportSubmitData,
  ExportStatusData,
} from '@/lib/types/api';

const TARGET = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

export const fakeEmbeddedWallet: WalletSummary = {
  id: '11111111-1111-1111-1111-111111111111',
  kind: 'embedded_passkey',
  address: 'CBRHXSWJPTNSHCLLX2QPA7THILWIY3BKJLPFI4GYJLDNPQRAI2ROOBME',
  exported: false,
};

export const fakeByowWallet: WalletSummary = {
  id: '22222222-2222-2222-2222-222222222222',
  kind: 'byow',
  address: 'GBRHXSWJPTNSHCLLX2QPA7THILWIY3BKJLPFI4GYJLDNPQRAI2ROXXXX',
  exported: false,
};

export const fakeExportedWallet: WalletSummary = { ...fakeEmbeddedWallet, exported: true };

// Enriched TOV-24 shapes (FR-01.03): a primary embedded wallet and a non-primary added BYOW wallet.
// The bare fixtures above intentionally omit isPrimary/createdAt to exercise the forward-compat path.
export const fakePrimaryWallet: WalletSummary = {
  id: '33333333-3333-3333-3333-333333333333',
  kind: 'embedded_passkey',
  address: 'CBRHXSWJPTNSHCLLX2QPA7THILWIY3BKJLPFI4GYJLDNPQRAI2ROPRIM',
  exported: false,
  isPrimary: true,
  createdAt: '2026-07-01T09:00:00.000Z',
};

export const fakeAddedByowWallet: WalletSummary = {
  id: '44444444-4444-4444-4444-444444444444',
  kind: 'byow',
  address: 'GBRHXSWJPTNSHCLLX2QPA7THILWIY3BKJLPFI4GYJLDNPQRAI2ROADDD',
  exported: false,
  isPrimary: false,
  createdAt: '2026-07-10T09:00:00.000Z',
};

// A non-primary BYOW that is also `exported` — the (rare) edge that exercises the load-bearing
// `!exported` clause in canSetPrimary (FR-01.04): it must NOT be eligible for set-primary and the
// row renders the exported badge (branch order: exported wins).
export const fakeExportedByowWallet: WalletSummary = {
  id: '55555555-5555-5555-5555-555555555555',
  kind: 'byow',
  address: 'GBRHXSWJPTNSHCLLX2QPA7THILWIY3BKJLPFI4GYJLDNPQRAI2ROEXPB',
  exported: true,
  isPrimary: false,
  createdAt: '2026-07-11T09:00:00.000Z',
};

export const fakeUsdcItem: ExportItem = {
  itemId: 'aaaa1111-0000-0000-0000-000000000001',
  tokenContract: 'CAUSDC00000000000000000000000000000000000000000000000000',
  tokenKind: 'usdc',
  amountScaled: '105000000', // 10.5 USDC at 7 decimals
  decimals: 7,
  assetCode: 'USDC',
  displayName: 'USDC',
  challenge: 'Y2hhbGxlbmdlLXVzZGM',
  expiresAtLedger: 1234567,
};

export const fakeFractionItem: ExportItem = {
  itemId: 'aaaa1111-0000-0000-0000-000000000002',
  tokenContract: 'CAFRACTION00000000000000000000000000000000000000000000000',
  tokenKind: 'fraction',
  amountScaled: '5',
  decimals: 0,
  assetCode: 'ART',
  displayName: 'ART',
  challenge: 'Y2hhbGxlbmdlLWZyYWM',
  expiresAtLedger: 1234567,
};

export const fakeExportBegin200: ExportBeginData = {
  exportId: 'bbbb2222-0000-0000-0000-000000000001',
  targetAddress: TARGET,
  credentialId: 'Y3JlZElk',
  transports: 'internal',
  rpId: 'tove.io',
  items: [fakeUsdcItem, fakeFractionItem],
};

export const fakeSubmit200: ExportSubmitData = {
  state: 'submitting',
};

export const fakeStatusConfirmed: ExportStatusData = {
  exportId: fakeExportBegin200.exportId,
  state: 'confirmed',
  selfCustodyAddress: TARGET,
  items: [
    {
      tokenContract: fakeUsdcItem.tokenContract,
      tokenKind: 'usdc',
      status: 'confirmed',
      txHash: 'ab12',
    },
    {
      tokenContract: fakeFractionItem.tokenContract,
      tokenKind: 'fraction',
      status: 'confirmed',
      txHash: 'cd34',
    },
  ],
};

// Error bodies (backend keys errors on `errorCode`).
export const fakeNotWhitelisted422 = {
  errorCode: 'RECIPIENT_NOT_WHITELISTED',
  message: 'The destination must complete KYC before it can receive assets.',
};
export const fakeExportNotAvailable422 = {
  errorCode: 'EXPORT_NOT_AVAILABLE',
  message: 'This wallet cannot be exported.',
};
export const fakeAlreadyExported409 = {
  errorCode: 'ALREADY_EXPORTED',
  message: 'This wallet has already been exported.',
};
