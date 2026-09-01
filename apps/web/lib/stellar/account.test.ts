import { describe, it, expect } from 'vitest';
import {
  isValidStellarPublicKey,
  classifyUsdcTrustline,
  getNativeBalance,
  getNativeSellingLiabilities,
  type BalanceLineLike,
} from '@/lib/stellar/account';

const USDC = {
  code: 'USDC',
  issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
};
const G = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';

describe('isValidStellarPublicKey', () => {
  it('accepts a 56-char G-strkey', () => {
    expect(isValidStellarPublicKey(G)).toBe(true);
  });
  it('rejects wrong prefix / length / injection chars', () => {
    expect(isValidStellarPublicKey('SDJVU7DR')).toBe(false);
    expect(isValidStellarPublicKey(`${G}/../transactions`)).toBe(false);
    expect(isValidStellarPublicKey('')).toBe(false);
  });
});

describe('classifyUsdcTrustline', () => {
  const native: BalanceLineLike = { asset_type: 'native', balance: '5' };
  const usdcLine: BalanceLineLike = {
    asset_type: 'credit_alphanum4',
    asset_code: 'USDC',
    asset_issuer: USDC.issuer,
    balance: '0',
  };

  it("'active' when an authorized-or-unset USDC line exists", () => {
    expect(classifyUsdcTrustline([native, usdcLine], USDC)).toBe('active');
    expect(classifyUsdcTrustline([native, { ...usdcLine, is_authorized: true }], USDC)).toBe(
      'active',
    );
  });

  it("'missing' when the line is absent, a different issuer, or explicitly unauthorized", () => {
    expect(classifyUsdcTrustline([native], USDC)).toBe('missing');
    expect(classifyUsdcTrustline([native, { ...usdcLine, asset_issuer: 'GOTHER' }], USDC)).toBe(
      'missing',
    );
    expect(classifyUsdcTrustline([native, { ...usdcLine, is_authorized: false }], USDC)).toBe(
      'missing',
    );
  });
});

describe('native balance helpers', () => {
  it('reads native balance and selling liabilities, defaulting to 0', () => {
    const balances: BalanceLineLike[] = [
      { asset_type: 'native', balance: '3.5', selling_liabilities: '1.2' },
    ];
    expect(getNativeBalance(balances)).toBe('3.5');
    expect(getNativeSellingLiabilities(balances)).toBe('1.2');
    expect(getNativeBalance([])).toBe('0');
    expect(getNativeSellingLiabilities([])).toBe('0');
  });
});
