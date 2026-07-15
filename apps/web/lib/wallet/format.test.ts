import { describe, it, expect } from 'vitest';
import {
  truncateAddress,
  explorerContractUrl,
  explorerAccountUrl,
  explorerTxUrl,
  formatTokenAmount,
  AMOUNT_UNAVAILABLE,
} from '@/lib/wallet/format';

const CONTRACT = 'CBRHXSWJPTNSHCLLX2QPA7THILWIY3BKJLPFI4GYJLDNPQRAI2ROOBME';
const ACCOUNT = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

describe('truncateAddress', () => {
  it('middle-truncates a long address as first6…last6', () => {
    expect(truncateAddress(CONTRACT)).toBe('CBRHXS…ROOBME');
    expect(truncateAddress(CONTRACT)).toBe(`${CONTRACT.slice(0, 6)}…${CONTRACT.slice(-6)}`);
  });

  it('returns short strings (<=14 chars) unchanged', () => {
    expect(truncateAddress('GABC123')).toBe('GABC123');
    expect(truncateAddress('')).toBe('');
  });
});

describe('explorer URLs', () => {
  // Default test env has no NEXT_PUBLIC_STELLAR_NETWORK → STELLAR_NETWORK.name === 'testnet'.
  it('builds a contract URL on the /contract/ path', () => {
    expect(explorerContractUrl(CONTRACT)).toBe(
      `https://stellar.expert/explorer/testnet/contract/${CONTRACT}`,
    );
  });

  it('builds an account URL on the /account/ path', () => {
    expect(explorerAccountUrl(ACCOUNT)).toBe(
      `https://stellar.expert/explorer/testnet/account/${ACCOUNT}`,
    );
  });

  it('uses distinct paths for contract vs account (guards the export /account/ pitfall)', () => {
    expect(explorerContractUrl(ACCOUNT)).toContain('/contract/');
    expect(explorerAccountUrl(ACCOUNT)).toContain('/account/');
  });

  it('builds a transaction URL on the /tx/ path', () => {
    expect(explorerTxUrl('abc123')).toBe('https://stellar.expert/explorer/testnet/tx/abc123');
  });
});

describe('formatTokenAmount', () => {
  it('scales by decimals and trims trailing zeros', () => {
    expect(formatTokenAmount('105000000', 7)).toBe('10.5'); // 10.5 USDC
    expect(formatTokenAmount('1', 7)).toBe('0.0000001');
    expect(formatTokenAmount('10000000', 7)).toBe('1');
  });

  it('returns the integer unchanged for 0 decimals (fractions)', () => {
    expect(formatTokenAmount('5', 0)).toBe('5');
  });

  it('handles values beyond Number.MAX_SAFE_INTEGER without precision loss', () => {
    expect(formatTokenAmount('90071992547409910000000', 7)).toBe('9007199254740991');
  });

  it('returns the AMOUNT_UNAVAILABLE sentinel for malformed input (never a raw/misleading number)', () => {
    expect(formatTokenAmount('', 7)).toBe(AMOUNT_UNAVAILABLE);
    expect(formatTokenAmount('1e21', 7)).toBe(AMOUNT_UNAVAILABLE);
    expect(formatTokenAmount('-5', 7)).toBe(AMOUNT_UNAVAILABLE);
    expect(formatTokenAmount('1.5', 7)).toBe(AMOUNT_UNAVAILABLE);
    expect(formatTokenAmount('100', -3)).toBe(AMOUNT_UNAVAILABLE);
    expect(formatTokenAmount('100', 2.5)).toBe(AMOUNT_UNAVAILABLE);
    expect(formatTokenAmount('100', 1e9)).toBe(AMOUNT_UNAVAILABLE); // no padStart OOM
  });
});
