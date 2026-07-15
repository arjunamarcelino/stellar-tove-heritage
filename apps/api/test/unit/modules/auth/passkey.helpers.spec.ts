import { describe, it, expect } from 'vitest';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type { CBORType } from '@levischuck/tiny-cbor';
import { decodeCoseToRawP256, extractClientChallenge } from '../../../../src/modules/auth/passkey.helpers';
import { createSoftwarePasskey } from '../../../shared/webauthn-authenticator';

describe('passkey.helpers', () => {
  describe('decodeCoseToRawP256', () => {
    it('returns the 65-byte 0x04||x||y point for a valid P-256 key', () => {
      const raw = decodeCoseToRawP256(createSoftwarePasskey().cosePublicKey);
      expect(raw.length).toBe(65);
      expect(raw[0]).toBe(0x04);
    });

    it('throws on a non-P-256 (Ed25519) COSE key', () => {
      // OKP / Ed25519: kty=1->1, alg=3->-8, crv=-1->6, x=-2
      const okp = isoCBOR.encode(
        new Map<number, CBORType>([
          [1, 1],
          [3, -8],
          [-1, 6],
          [-2, new Uint8Array(32)],
        ]),
      );
      expect(() => decodeCoseToRawP256(okp)).toThrow();
    });

    it('throws on malformed bytes', () => {
      expect(() => decodeCoseToRawP256(new Uint8Array([1, 2, 3]))).toThrow();
    });
  });

  describe('extractClientChallenge', () => {
    it('throws when clientDataJSON is not valid JSON', () => {
      const bad = {
        response: { clientDataJSON: Buffer.from('nope').toString('base64url') },
      } as never;
      expect(() => extractClientChallenge(bad)).toThrow();
    });
  });
});
