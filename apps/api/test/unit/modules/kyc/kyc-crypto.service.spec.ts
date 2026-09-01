import { describe, it, expect } from 'vitest';
import { ConfigKeyWrapper } from '@modules/kyc/crypto/config-key-wrapper';
import { KycCryptoService, KycDecryptionError } from '@modules/kyc/crypto/kyc-crypto.service';
import type { KycConfig } from '@config/kyc.config';

const KEY_A = Buffer.alloc(32, 7).toString('base64');
const KEY_B = Buffer.alloc(32, 9).toString('base64');

function cfg(over: Partial<KycConfig> = {}): KycConfig {
  return {
    bucket: 'tove-kyc',
    masterKeyBase64: KEY_A,
    masterKeyVersion: 1,
    signedUrlTtl: 90,
    jurisdictionAllowlist: ['GB'],
    maxConcurrentSubmissions: 4,
    ...over,
  };
}

function make(over: Partial<KycConfig> = {}): KycCryptoService {
  const c = cfg(over);
  return new KycCryptoService(new ConfigKeyWrapper(c), c);
}

const AAD = 'user-1|sub-1|selfie';

describe('KycCryptoService', () => {
  it('round-trips encrypt → decrypt back to the original plaintext', async () => {
    const svc = make();
    const plaintext = Buffer.from('a government id scan', 'utf8');
    const enc = await svc.encryptDocument(plaintext, AAD);
    const out = await svc.decryptDocument(enc.blob, enc.wrappedDek, AAD);
    expect(out.equals(plaintext)).toBe(true);
  });

  it('wraps the DEK to exactly 60 bytes (matches the DB octet_length CHECK)', async () => {
    const enc = await make().encryptDocument(Buffer.from('x'), AAD);
    expect(enc.wrappedDek.wrapped.length).toBe(60);
    expect(enc.wrappedDek.keyVersion).toBe(1);
  });

  it('hashPlaintext is a keyed HMAC: deterministic per key, differs under a different master key', async () => {
    const plaintext = Buffer.from('same bytes');
    const a1 = await make().hashPlaintext(plaintext);
    const a2 = await make().hashPlaintext(plaintext);
    const b = await make({ masterKeyBase64: KEY_B }).hashPlaintext(plaintext);
    expect(a1).toBe(a2); // deterministic for the same key
    expect(a1).not.toBe(b); // keyed — a different master key ⇒ different hash
    expect(a1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('two encryptions of identical plaintext produce different blobs (fresh IV + DEK)', async () => {
    const svc = make();
    const plaintext = Buffer.from('identical');
    const e1 = await svc.encryptDocument(plaintext, AAD);
    const e2 = await svc.encryptDocument(plaintext, AAD);
    expect(e1.blob.equals(e2.blob)).toBe(false);
  });

  it('rejects tampered ciphertext with an auth_tag KycDecryptionError', async () => {
    const svc = make();
    const enc = await svc.encryptDocument(Buffer.from('secret'), AAD);
    const tampered = Buffer.from(enc.blob);
    tampered[tampered.length - 1] ^= 0xff;
    await expect(svc.decryptDocument(tampered, enc.wrappedDek, AAD)).rejects.toMatchObject({
      name: 'KycDecryptionError',
      reason: 'auth_tag',
    });
  });

  it('rejects a wrong AAD (different logical slot) — cannot re-label one doc as another', async () => {
    const svc = make();
    const enc = await svc.encryptDocument(Buffer.from('secret'), AAD);
    await expect(
      svc.decryptDocument(enc.blob, enc.wrappedDek, 'user-1|sub-1|gov_id_front'),
    ).rejects.toBeInstanceOf(KycDecryptionError);
  });

  it('rejects an unknown key version at unwrap', async () => {
    const svc = make();
    const enc = await svc.encryptDocument(Buffer.from('secret'), AAD);
    const wrong = { wrapped: enc.wrappedDek.wrapped, keyVersion: 999 };
    await expect(svc.decryptDocument(enc.blob, wrong, AAD)).rejects.toMatchObject({
      reason: 'unwrap',
    });
  });

  it('round-trips 0-byte and 10MB documents', async () => {
    const svc = make();
    for (const size of [0, 10 * 1024 * 1024]) {
      const plaintext = Buffer.alloc(size, 0xab);
      const enc = await svc.encryptDocument(plaintext, AAD);
      const out = await svc.decryptDocument(enc.blob, enc.wrappedDek, AAD);
      expect(out.length).toBe(size);
      expect(out.equals(plaintext)).toBe(true);
    }
  });

  it('fails fast when the master key is not 32 bytes', () => {
    expect(() => make({ masterKeyBase64: Buffer.alloc(16).toString('base64') })).toThrow();
  });

  it('deterministicSubmissionId is deterministic, secret-keyed, and a valid UUID', () => {
    const a = make();
    const b = make({ masterKeyBase64: KEY_B });
    const id1 = a.deterministicSubmissionId('user-1', 'idem-1');
    const id2 = a.deterministicSubmissionId('user-1', 'idem-1');
    const idOtherKey = b.deterministicSubmissionId('user-1', 'idem-1');
    const idOtherInput = a.deterministicSubmissionId('user-1', 'idem-2');
    expect(id1).toBe(id2); // deterministic for same inputs
    expect(id1).not.toBe(idOtherKey); // secret-keyed — a different master key ⇒ different id
    expect(id1).not.toBe(idOtherInput); // different idempotency key ⇒ different id
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('binds the DEK wrap to the key version — a DEK wrapped at v1 cannot be unwrapped at v2 (SEC-C1)', async () => {
    const w1 = new ConfigKeyWrapper(cfg({ masterKeyVersion: 1 }));
    const w2 = new ConfigKeyWrapper(cfg({ masterKeyVersion: 2 })); // same master key, different version
    const wrapped = await w1.wrapDek(Buffer.alloc(32, 3), AAD);
    expect(() => w2.unwrapDek(wrapped, AAD)).toThrow(/unknown KYC master-key version/);
  });
});
