import { describe, it, expect } from 'vitest';
import { parseAmount } from '../../../../src/modules/fractionalization/amount';
import { FractionReadUnavailableError } from '../../../../src/modules/fractionalization/fraction-read.errors';

describe('amount helpers', () => {
  describe('parseAmount', () => {
    it('parses a valid integer decimal string', () => {
      expect(parseAmount('60', 'balance')).toBe(60n);
      expect(parseAmount('0', 'balance')).toBe(0n);
      expect(parseAmount('-5', 'balance')).toBe(-5n);
    });

    it('rejects empty string, null, undefined (raw BigInt("") throws)', () => {
      expect(() => parseAmount('', 'balance')).toThrow(FractionReadUnavailableError);
      expect(() => parseAmount(null, 'balance')).toThrow(FractionReadUnavailableError);
      expect(() => parseAmount(undefined, 'balance')).toThrow(FractionReadUnavailableError);
    });

    it('rejects decimals and garbage', () => {
      expect(() => parseAmount('60.0', 'balance')).toThrow(FractionReadUnavailableError);
      expect(() => parseAmount('6e3', 'balance')).toThrow(FractionReadUnavailableError);
      expect(() => parseAmount('abc', 'balance')).toThrow(FractionReadUnavailableError);
    });

    it('rejects a negative value when { nonNegative: true } (a -N balance decode is corruption)', () => {
      expect(() => parseAmount('-5', 'balance', { nonNegative: true })).toThrow(FractionReadUnavailableError);
      expect(parseAmount('0', 'balance', { nonNegative: true })).toBe(0n);
      expect(parseAmount('7', 'balance', { nonNegative: true })).toBe(7n);
    });
  });

});
