import { describe, it, expect } from 'vitest';
import {
  isValidContractAddress,
  explorerContractUrl,
  explorerTxUrl,
  classifyAddress,
} from './stellar';

// A well-formed 56-char contract StrKey: 'C' + 55 base32 (A-Z2-7) chars.
const VALID = 'C' + 'A'.repeat(55);

describe('isValidContractAddress', () => {
  it('accepts a well-formed C… base32 contract key (positive)', () => {
    expect(isValidContractAddress(VALID)).toBe(true);
  });

  it('rejects non-base32 digits 0/1/8/9 (negative)', () => {
    expect(isValidContractAddress('C' + '0'.repeat(55))).toBe(false);
    expect(isValidContractAddress('C' + '8'.repeat(55))).toBe(false);
  });

  it('rejects wrong length, wrong prefix, lowercase, empty (edge)', () => {
    expect(isValidContractAddress('C' + 'A'.repeat(54))).toBe(false); // 55 total, too short
    expect(isValidContractAddress('C' + 'A'.repeat(56))).toBe(false); // 57 total, too long
    expect(isValidContractAddress('G' + 'A'.repeat(55))).toBe(false); // wrong prefix
    expect(isValidContractAddress(VALID.toLowerCase())).toBe(false);
    expect(isValidContractAddress('')).toBe(false);
  });
});

describe('explorerContractUrl', () => {
  it('builds a testnet contract URL for a valid address (positive)', () => {
    expect(explorerContractUrl(VALID)).toBe(
      `https://stellar.expert/explorer/testnet/contract/${VALID}`,
    );
  });

  it('returns null for a malformed address (negative)', () => {
    expect(explorerContractUrl('not-an-address')).toBeNull();
    expect(explorerContractUrl('C' + '1'.repeat(55))).toBeNull();
  });
});

describe('explorerTxUrl', () => {
  const HASH = 'a'.repeat(64);

  it('builds a testnet tx URL for a valid 64-hex hash (positive)', () => {
    expect(explorerTxUrl(HASH)).toBe(`https://stellar.expert/explorer/testnet/tx/${HASH}`);
  });

  it('lowercases a mixed-case hash (edge)', () => {
    expect(explorerTxUrl('AbCd' + 'e'.repeat(60))).toBe(
      `https://stellar.expert/explorer/testnet/tx/abcd${'e'.repeat(60)}`,
    );
  });

  it('returns null for a malformed hash (negative)', () => {
    expect(explorerTxUrl('deadbeef')).toBeNull(); // too short
    expect(explorerTxUrl('z'.repeat(64))).toBeNull(); // non-hex
    expect(explorerTxUrl('')).toBeNull();
  });
});

describe('classifyAddress', () => {
  it('classifies each StrKey prefix (positive)', () => {
    expect(classifyAddress('C' + 'A'.repeat(55))).toBe('contract');
    expect(classifyAddress('G' + 'A'.repeat(55))).toBe('account');
    expect(classifyAddress('S' + 'A'.repeat(55))).toBe('secret');
    expect(classifyAddress('M' + 'A'.repeat(68))).toBe('muxed');
    expect(classifyAddress('0x' + 'a'.repeat(40))).toBe('evm');
  });

  it('is case-insensitive for a lowercased StrKey paste (edge)', () => {
    expect(classifyAddress('c' + 'a'.repeat(55))).toBe('contract');
    expect(classifyAddress('g' + 'a'.repeat(55))).toBe('account');
  });

  it('returns "unknown" for anything else (negative)', () => {
    expect(classifyAddress('not-an-address')).toBe('unknown');
    expect(classifyAddress('C' + 'A'.repeat(54))).toBe('unknown'); // wrong length
    expect(classifyAddress('')).toBe('unknown');
  });
});
