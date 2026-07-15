import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  decodeCredentialId,
  deriveSalt,
  buildKeyData,
} from '../../../../src/modules/relayer/signer-encoding';

// Byte-exact vectors (real crypto, no SDK mock) — lock the smart-account-kit compatibility:
// key_data = pubkey(65) ‖ rawCredentialId ; salt = sha256(rawCredentialId).
describe('signer-encoding (smart-account-kit compatibility)', () => {
  const credentialId = 'AQIDBA'; // base64url of bytes [1,2,3,4]
  const rawCredId = Buffer.from([1, 2, 3, 4]);
  const pubkey = new Uint8Array(65).fill(7);
  pubkey[0] = 0x04;

  it('decodeCredentialId base64url-decodes to raw bytes', () => {
    expect(decodeCredentialId(credentialId)).toEqual(rawCredId);
  });

  it('deriveSalt = sha256(raw credential-id bytes), 32 bytes', () => {
    const salt = deriveSalt(credentialId);
    expect(salt).toEqual(createHash('sha256').update(rawCredId).digest());
    expect(salt).toHaveLength(32);
  });

  it('buildKeyData = pubkey(65) ‖ rawCredentialId, pubkey first', () => {
    const keyData = buildKeyData(pubkey, credentialId);
    expect(keyData).toHaveLength(65 + rawCredId.length);
    expect(keyData.subarray(0, 65)).toEqual(Buffer.from(pubkey));
    expect(keyData.subarray(65)).toEqual(rawCredId);
    // and the credential id is recoverable from the tail (smart-account-kit getCredentialIdFromSigner)
    expect(keyData.subarray(65)).toEqual(decodeCredentialId(credentialId));
  });

  it('buildKeyData rejects a non-65-byte public key (fail loud before an on-chain deploy)', () => {
    expect(() => buildKeyData(new Uint8Array(64), credentialId)).toThrow(/65-byte/);
    expect(() => buildKeyData(new Uint8Array(0), credentialId)).toThrow(/65-byte/);
  });
});
