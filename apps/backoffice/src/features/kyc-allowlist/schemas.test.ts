import { describe, it, expect } from 'vitest';

import {
  allowlistActionInputSchema,
  allowlistBatchRequestSchema,
  allowlistItemResultSchema,
  reasonSchema,
  walletSchema,
} from './schemas';

const VALID_WALLET = 'C' + 'A'.repeat(55);

describe('walletSchema', () => {
  it('accepts a valid C… contract address (positive)', () => {
    expect(walletSchema.safeParse(VALID_WALLET).success).toBe(true);
  });

  it('rejects a G… account, wrong length, lowercase (negative/edge)', () => {
    expect(walletSchema.safeParse('G' + 'A'.repeat(55)).success).toBe(false);
    expect(walletSchema.safeParse('C' + 'A'.repeat(54)).success).toBe(false);
    expect(walletSchema.safeParse(VALID_WALLET.toLowerCase()).success).toBe(false);
    expect(walletSchema.safeParse('C' + '0'.repeat(55)).success).toBe(false); // 0 not in base32
  });
});

describe('reasonSchema', () => {
  it('accepts a snake_case code (positive)', () => {
    expect(reasonSchema.safeParse('kyc_passed').success).toBe(true);
  });

  it('rejects spaces, uppercase, hyphen, empty, >64 (negative/edge)', () => {
    expect(reasonSchema.safeParse('kyc passed').success).toBe(false);
    expect(reasonSchema.safeParse('KYC').success).toBe(false);
    expect(reasonSchema.safeParse('kyc-passed').success).toBe(false);
    expect(reasonSchema.safeParse('').success).toBe(false);
    expect(reasonSchema.safeParse('a'.repeat(65)).success).toBe(false);
  });
});

describe('allowlistActionInputSchema', () => {
  it('accepts add/remove with optional reason (positive)', () => {
    expect(
      allowlistActionInputSchema.safeParse({ wallet: VALID_WALLET, action: 'add' }).success,
    ).toBe(true);
    expect(
      allowlistActionInputSchema.safeParse({
        wallet: VALID_WALLET,
        action: 'remove',
        reason: 'sanctions_clear',
      }).success,
    ).toBe(true);
  });

  it('rejects unknown fields via .strict() and bad actions (negative)', () => {
    expect(
      allowlistActionInputSchema.safeParse({ wallet: VALID_WALLET, action: 'add', evil: 1 }).success,
    ).toBe(false);
    expect(
      allowlistActionInputSchema.safeParse({ wallet: VALID_WALLET, action: 'freeze' }).success,
    ).toBe(false);
  });
});

describe('allowlistBatchRequestSchema', () => {
  it('requires exactly one item (edge)', () => {
    const item = { wallet: VALID_WALLET, action: 'add' as const };
    expect(allowlistBatchRequestSchema.safeParse({ items: [item] }).success).toBe(true);
    expect(allowlistBatchRequestSchema.safeParse({ items: [] }).success).toBe(false);
    expect(allowlistBatchRequestSchema.safeParse({ items: [item, item] }).success).toBe(false);
  });
});

describe('allowlistItemResultSchema', () => {
  it('parses each status with its nullable field shape (positive/edge)', () => {
    const confirmed = {
      wallet: VALID_WALLET,
      action: 'add',
      status: 'confirmed',
      isAllowed: true,
      txHash: 'a'.repeat(64),
      errorReason: null,
    };
    const noop = { ...confirmed, status: 'noop', txHash: null };
    const failed = { ...confirmed, status: 'failed', isAllowed: null, txHash: null, errorReason: 'x' };
    expect(allowlistItemResultSchema.safeParse(confirmed).success).toBe(true);
    expect(allowlistItemResultSchema.safeParse(noop).success).toBe(true);
    expect(allowlistItemResultSchema.safeParse(failed).success).toBe(true);
  });

  it('tolerates additive backend fields (lenient response) (edge)', () => {
    const withExtra = {
      wallet: VALID_WALLET,
      action: 'add',
      status: 'confirmed',
      isAllowed: true,
      txHash: 'a'.repeat(64),
      errorReason: null,
      ledger: 12345,
    };
    expect(allowlistItemResultSchema.safeParse(withExtra).success).toBe(true);
  });
});
