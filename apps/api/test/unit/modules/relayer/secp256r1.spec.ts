import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign, KeyObject } from 'node:crypto';
import { p256 } from '@noble/curves/p256';
import {
  toLowSCompactSignature,
  webauthnSignedMessage,
  verifyP256Assertion,
} from '../../../../src/modules/relayer/secp256r1';

// Real-crypto round trip (no SDK mock): a software P-256 key stands in for a passkey. Locks the
// low-S trap — Soroban rejects high-S, so we must normalize AND verify the normalized bytes.
describe('secp256r1 (passkey assertion crypto)', () => {
  const rawPublicKey = (pub: KeyObject): Uint8Array => {
    const jwk = pub.export({ format: 'jwk' }) as { x: string; y: string };
    return Buffer.concat([
      Buffer.from([0x04]),
      Buffer.from(jwk.x, 'base64url'),
      Buffer.from(jwk.y, 'base64url'),
    ]);
  };

  // Sign the WebAuthn message the way an authenticator does: ECDSA over sha256(authData ‖ sha256(cdj)).
  const signAssertion = (
    key: KeyObject,
    authData: Uint8Array,
    clientDataJSON: Uint8Array,
  ): Buffer => sign('sha256', webauthnSignedMessage(authData, clientDataJSON), { key, dsaEncoding: 'der' });

  const authData = Buffer.from('authenticator-data-bytes');
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: 'abc' }));

  it('verifies a low-S-normalized assertion against the bound key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const der = signAssertion(privateKey, authData, clientDataJSON);
    const compact = toLowSCompactSignature(der);
    expect(compact.length).toBe(64);
    expect(verifyP256Assertion(rawPublicKey(publicKey), authData, clientDataJSON, compact)).toBe(true);
  });

  it('normalizes a high-S signature to low-S (the on-chain-rejection trap)', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    // Find a message whose signature comes out high-S (probabilistic ~50%), bounded.
    let der: Buffer | undefined;
    let highSData: Buffer | undefined;
    for (let i = 0; i < 40; i++) {
      const cdj = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: `n-${i}` }));
      const candidate = signAssertion(privateKey, authData, cdj);
      if (p256.Signature.fromDER(candidate).hasHighS()) {
        der = candidate;
        highSData = cdj;
        break;
      }
    }
    expect(der, 'expected to produce a high-S signature within 40 tries').toBeDefined();

    const compact = toLowSCompactSignature(der!);
    // The normalized compact is low-S and verifies.
    expect(p256.Signature.fromCompact(compact).hasHighS()).toBe(false);
    expect(verifyP256Assertion(rawPublicKey(publicKey), authData, highSData!, compact)).toBe(true);

    // The RAW high-S bytes must NOT pass a low-S-enforcing verify (what the chain would reject).
    const rawHighS = Buffer.from(p256.Signature.fromDER(der!).toCompactRawBytes());
    expect(verifyP256Assertion(rawPublicKey(publicKey), authData, highSData!, rawHighS)).toBe(false);
  });

  it('rejects an assertion signed by a different key', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const { publicKey: otherPub } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const compact = toLowSCompactSignature(signAssertion(privateKey, authData, clientDataJSON));
    expect(verifyP256Assertion(rawPublicKey(otherPub), authData, clientDataJSON, compact)).toBe(false);
  });

  it('rejects tampered clientDataJSON (message binding)', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const compact = toLowSCompactSignature(signAssertion(privateKey, authData, clientDataJSON));
    const tampered = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: 'DIFFERENT' }));
    expect(verifyP256Assertion(rawPublicKey(publicKey), authData, tampered, compact)).toBe(false);
  });

  it('throws on a malformed public key or signature length', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const compact = toLowSCompactSignature(signAssertion(privateKey, authData, clientDataJSON));
    expect(() => verifyP256Assertion(new Uint8Array(64), authData, clientDataJSON, compact)).toThrow();
    expect(() => verifyP256Assertion(rawPublicKey(publicKey), authData, clientDataJSON, new Uint8Array(63))).toThrow();
  });
});
