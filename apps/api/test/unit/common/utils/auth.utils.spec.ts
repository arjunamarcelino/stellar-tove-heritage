import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import {
  TIMING_SAFE_DUMMY_HASH,
  hashRefreshToken,
  verifyRefreshToken,
  parseDurationMs,
} from '@common/utils/auth.utils';

const TEST_HMAC_SECRET = 'test-hmac-secret-that-is-32-characters';

describe('auth.utils', () => {
  describe('TIMING_SAFE_DUMMY_HASH', () => {
    it('should be a valid bcrypt hash', () => {
      expect(TIMING_SAFE_DUMMY_HASH).toMatch(/^\$2[aby]?\$\d{2}\$/);
    });
  });

  describe('hashRefreshToken', () => {
    it('should produce a hex-encoded HMAC-SHA256 hash', () => {
      const hash = hashRefreshToken('test-token', TEST_HMAC_SECRET);

      expect(hash).toHaveLength(64); // SHA-256 = 32 bytes = 64 hex chars
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it('should produce deterministic output for the same input', () => {
      const hash1 = hashRefreshToken('same-token', TEST_HMAC_SECRET);
      const hash2 = hashRefreshToken('same-token', TEST_HMAC_SECRET);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different tokens', () => {
      const hash1 = hashRefreshToken('token-a', TEST_HMAC_SECRET);
      const hash2 = hashRefreshToken('token-b', TEST_HMAC_SECRET);

      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hashes for different secrets', () => {
      const hash1 = hashRefreshToken('same-token', 'secret-one-that-is-32-chars-long!');
      const hash2 = hashRefreshToken('same-token', 'secret-two-that-is-32-chars-long!');

      expect(hash1).not.toBe(hash2);
    });

    it('should match manual HMAC-SHA256 computation', () => {
      const token = 'manual-test-token';
      const expected = createHmac('sha256', TEST_HMAC_SECRET)
        .update(token)
        .digest('hex');

      expect(hashRefreshToken(token, TEST_HMAC_SECRET)).toBe(expected);
    });
  });

  describe('verifyRefreshToken', () => {
    it('should return true for matching token and hash', () => {
      const token = 'valid-refresh-token';
      const hash = hashRefreshToken(token, TEST_HMAC_SECRET);

      expect(verifyRefreshToken(token, hash, TEST_HMAC_SECRET)).toBe(true);
    });

    it('should return false for non-matching token', () => {
      const hash = hashRefreshToken('original-token', TEST_HMAC_SECRET);

      expect(verifyRefreshToken('wrong-token', hash, TEST_HMAC_SECRET)).toBe(false);
    });

    it('should return false for wrong secret', () => {
      const token = 'test-token';
      const hash = hashRefreshToken(token, TEST_HMAC_SECRET);

      expect(verifyRefreshToken(token, hash, 'different-secret-32-chars-long!!!')).toBe(false);
    });
  });

  describe('parseDurationMs', () => {
    it('should parse seconds', () => {
      expect(parseDurationMs('30s')).toBe(30_000);
    });

    it('should parse minutes', () => {
      expect(parseDurationMs('15m')).toBe(900_000);
    });

    it('should parse hours', () => {
      expect(parseDurationMs('2h')).toBe(7_200_000);
    });

    it('should parse days', () => {
      expect(parseDurationMs('7d')).toBe(604_800_000);
    });

    it('should return 7 days fallback for invalid format', () => {
      const sevenDaysMs = 7 * 86_400_000;
      expect(parseDurationMs('invalid')).toBe(sevenDaysMs);
      expect(parseDurationMs('')).toBe(sevenDaysMs);
      expect(parseDurationMs('10x')).toBe(sevenDaysMs);
    });
  });
});
