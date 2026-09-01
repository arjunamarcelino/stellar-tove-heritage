import { convertCOSEtoPKCS, cose, decodeCredentialPublicKey } from '@simplewebauthn/server/helpers';

/**
 * Decode a COSE public key to the raw uncompressed secp256r1/P-256 point
 * (0x04 || x(32) || y(32) = 65 bytes) that the Soroban smart wallet binds to.
 * Asserts EC2 / ES256 / P-256 with zero casts; throws otherwise.
 *
 * Lives in the wallets aggregate: the stored `PasskeyCredential.publicKey` is a wallets concern, and
 * keeping the `@simplewebauthn` dependency here means the relayer does not depend on `@simplewebauthn`
 * (it owns raw WebAuthn *assertion* verification manually in `passkey-authorization.ts`; COSE
 * *credential* decoding stays here). Both the passkey registration flow (via a re-export in
 * `auth/passkey.helpers.ts`) and the transfer flow decode the stored credential through this function.
 */
export function decodeCoseToRawP256(cosePublicKey: Uint8Array): Uint8Array {
  // Normalize to a fresh ArrayBuffer-backed Uint8Array (the helpers require it).
  const bytes = Uint8Array.from(cosePublicKey);
  const decoded = decodeCredentialPublicKey(bytes);
  if (!cose.isCOSEPublicKeyEC2(decoded)) {
    throw new Error('passkey public key is not an EC2 key');
  }
  const alg = decoded.get(cose.COSEKEYS.alg);
  const crv = decoded.get(cose.COSEKEYS.crv);
  const x = decoded.get(cose.COSEKEYS.x);
  const y = decoded.get(cose.COSEKEYS.y);
  if (alg !== cose.COSEALG.ES256) {
    throw new Error('passkey public key is not ES256');
  }
  if (crv !== cose.COSECRV.P256) {
    throw new Error('passkey public key is not on the P-256 curve');
  }
  if (!(x instanceof Uint8Array) || x.length !== 32 || !(y instanceof Uint8Array) || y.length !== 32) {
    throw new Error('passkey public key has malformed coordinates');
  }
  const pkcs = convertCOSEtoPKCS(bytes);
  if (pkcs.length !== 65 || pkcs[0] !== 0x04) {
    throw new Error('failed to derive an uncompressed P-256 point');
  }
  return pkcs;
}
