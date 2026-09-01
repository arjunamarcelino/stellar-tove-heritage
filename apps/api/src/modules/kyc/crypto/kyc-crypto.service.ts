import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { kycConfig } from '@config/kyc.config';
import { IKeyWrapper, KEY_WRAPPER, WrappedDek } from './key-wrapper.interface';

const IV_LEN = 12;
const TAG_LEN = 16;
/** HKDF label giving the blob-hash HMAC key clean domain separation from the wrapping KEK (SEC-H1/O4). */
const BLOB_HASH_INFO = 'kyc-blob-hash';
/** HKDF label for the submission-id HMAC key (SEC-H2 / review #195) — separate domain from the KEK/hash key. */
const SUBMISSION_ID_INFO = 'kyc-submission-id';
/** Cipher/HMAC chunk size — the loop yields the event loop between chunks (#187). */
const CHUNK = 64 * 1024;

/** Yield the event loop for one tick so a large cipher/HMAC can't monopolize the thread. */
function yieldTick(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/** Output of envelope-encrypting one KYC document. The `blob_hash` is computed once by the caller (via
 * {@link KycCryptoService.hashPlaintext}) and reused for both the idempotency fingerprint and the row, so
 * it is intentionally NOT recomputed here. */
export interface EncryptedDocument {
  /** iv(12) ‖ authTag(16) ‖ ciphertext — the stored blob. */
  blob: Buffer;
  /** The per-document DEK wrapped by the master KEK + the version that wrapped it. */
  wrappedDek: WrappedDek;
}

/** Discriminated decryption failure so the later read path can classify (tamper vs un-migrated key). */
export class KycDecryptionError extends Error {
  constructor(
    readonly reason: 'auth_tag' | 'unwrap',
    message: string,
  ) {
    super(message);
    this.name = 'KycDecryptionError';
  }
}

/**
 * Envelope encryption for KYC documents (TOV-28). Each document gets a fresh random DEK (D1); the blob is
 * AES-256-GCM with a per-blob IV and an AAD binding it to `userId|submissionId|docType`; the DEK is wrapped
 * by the master KEK (context-bound, SEC-C1). `blob_hash` is a KEYED HMAC of the PLAINTEXT (SEC-H1) — the
 * HMAC key is HKDF-derived from the master key, so a DB-only compromise yields no offline confirmation
 * oracle. Callers must reconstruct `aad` from trusted server-side values, never from request input.
 */
@Injectable()
export class KycCryptoService {
  private readonly blobHashKey: Buffer;
  private readonly submissionIdKey: Buffer;

  constructor(
    @Inject(KEY_WRAPPER) private readonly keyWrapper: IKeyWrapper,
    @Inject(kycConfig.KEY) config: ConfigType<typeof kycConfig>,
  ) {
    const masterKey = Buffer.from(config.masterKeyBase64, 'base64');
    if (masterKey.length !== 32) {
      throw new Error('KYC_MASTER_KEY must decode to exactly 32 bytes');
    }
    this.blobHashKey = Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), BLOB_HASH_INFO, 32));
    this.submissionIdKey = Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), SUBMISSION_ID_INFO, 32));
  }

  /**
   * Deterministic-but-SECRET submission id from `(userId, idempotencyKey)` (SEC-H2 + review #195). HMAC-keyed
   * with a master-key-derived subkey, so — unlike a bare hash — it is NOT reconstructable from client-known
   * values. Deterministic for a given key pair (an idempotent retry reuses the same id / storage keys →
   * `upsert:false` avoids orphans). RFC-4122 v5-shaped so it is a valid `uuid` column value.
   */
  deterministicSubmissionId(userId: string, idempotencyKey: string): string {
    const mac = createHmac('sha256', this.submissionIdKey).update(`${userId}:${idempotencyKey}`).digest();
    const b = Buffer.from(mac.subarray(0, 16));
    b[6] = (b[6] & 0x0f) | 0x50; // version 5
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
    const h = b.toString('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  }

  /**
   * Encrypt one document. `aad` = `${userId}|${submissionId}|${docType}`. The cipher runs over the ~10MB
   * buffer in {@link CHUNK}-sized slices, yielding the event loop between chunks (#187) so a large submission
   * doesn't monopolize the thread; the concurrency gate bounds how many run at once.
   */
  async encryptDocument(plaintext: Buffer, aad: string): Promise<EncryptedDocument> {
    const dek = randomBytes(32);
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', dek, iv, { authTagLength: TAG_LEN });
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const parts: Buffer[] = [];
    for (let off = 0; off < plaintext.length; off += CHUNK) {
      parts.push(cipher.update(plaintext.subarray(off, off + CHUNK)));
      if (off + CHUNK < plaintext.length) await yieldTick();
    }
    parts.push(cipher.final());
    const blob = Buffer.concat([iv, cipher.getAuthTag(), ...parts]);
    const wrappedDek = await this.keyWrapper.wrapDek(dek, aad);
    return { blob, wrappedDek };
  }

  /** Decrypt one document (format-proofing now; the read HTTP surface is a later ticket). Chunked like encrypt. */
  async decryptDocument(blob: Buffer, wrappedDek: WrappedDek, aad: string): Promise<Buffer> {
    let dek: Buffer;
    try {
      dek = await this.keyWrapper.unwrapDek(wrappedDek, aad);
    } catch (err) {
      throw new KycDecryptionError('unwrap', `failed to unwrap DEK: ${String(err)}`);
    }
    const iv = blob.subarray(0, IV_LEN);
    const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ciphertext = blob.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv('aes-256-gcm', dek, iv, { authTagLength: TAG_LEN });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    try {
      const parts: Buffer[] = [];
      for (let off = 0; off < ciphertext.length; off += CHUNK) {
        parts.push(decipher.update(ciphertext.subarray(off, off + CHUNK)));
        if (off + CHUNK < ciphertext.length) await yieldTick();
      }
      parts.push(decipher.final()); // throws on tamper / wrong AAD / wrong key
      return Buffer.concat(parts);
    } catch (err) {
      throw new KycDecryptionError('auth_tag', `blob integrity check failed: ${String(err)}`);
    }
  }

  /**
   * Keyed HMAC-SHA256(plaintext), hex — used for `blob_hash` and the idempotency fingerprint. Chunked +
   * yielding like {@link encryptDocument} so a large hash doesn't block the loop (#187).
   */
  async hashPlaintext(plaintext: Buffer): Promise<string> {
    const hmac = createHmac('sha256', this.blobHashKey);
    for (let off = 0; off < plaintext.length; off += CHUNK) {
      hmac.update(plaintext.subarray(off, off + CHUNK));
      if (off + CHUNK < plaintext.length) await yieldTick();
    }
    return hmac.digest('hex');
  }
}
