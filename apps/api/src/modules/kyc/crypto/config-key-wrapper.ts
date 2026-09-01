import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { kycConfig } from '@config/kyc.config';
import { IKeyWrapper, WrappedDek } from './key-wrapper.interface';

const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * MVP {@link IKeyWrapper}: wraps a DEK with AES-256-GCM under the config master KEK, binding the wrap to
 * its row via AAD (SEC-C1). Layout: `iv(12) ‖ tag(16) ‖ ciphertext`. Single active key version for MVP;
 * `unwrapDek` throws on an unknown version so a future rotation (multiple concurrent KEKs) is an additive
 * change, never a silent wrong-key decrypt. Master key is validated to 32 bytes at construction (fail-fast).
 */
@Injectable()
export class ConfigKeyWrapper implements IKeyWrapper {
  private readonly masterKey: Buffer;
  private readonly keyVersion: number;

  constructor(@Inject(kycConfig.KEY) config: ConfigType<typeof kycConfig>) {
    this.masterKey = Buffer.from(config.masterKeyBase64, 'base64');
    if (this.masterKey.length !== 32) {
      throw new Error('KYC_MASTER_KEY must decode to exactly 32 bytes');
    }
    this.keyVersion = config.masterKeyVersion;
  }

  wrapDek(dek: Buffer, aad: string): Promise<WrappedDek> {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv, { authTagLength: TAG_LEN });
    // Bind the wrap to the KEY VERSION as well as the row (SEC-C1) — this is what makes the wrapped DEK
    // undecryptable under the wrong version once rotation exists, matching the IKeyWrapper contract.
    cipher.setAAD(Buffer.from(this.boundAad(aad, this.keyVersion), 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
    const wrapped = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    return Promise.resolve({ wrapped, keyVersion: this.keyVersion });
  }

  unwrapDek(wrappedDek: WrappedDek, aad: string): Promise<Buffer> {
    const kek = this.kekForVersion(wrappedDek.keyVersion);
    const { wrapped } = wrappedDek;
    const iv = wrapped.subarray(0, IV_LEN);
    const tag = wrapped.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ciphertext = wrapped.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv('aes-256-gcm', kek, iv, { authTagLength: TAG_LEN });
    decipher.setAAD(Buffer.from(this.boundAad(aad, wrappedDek.keyVersion), 'utf8'));
    decipher.setAuthTag(tag);
    // `final()` throws on tamper / wrong AAD / wrong key version — the integrity check.
    return Promise.resolve(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  }

  /** The DEK-wrap AAD: the caller's row AAD plus the master-key version (SEC-C1 contract). */
  private boundAad(aad: string, keyVersion: number): string {
    return `${aad}|${keyVersion}`;
  }

  /** MVP has one key; a future rotation registers more versions here. Unknown version = hard failure. */
  private kekForVersion(version: number): Buffer {
    if (version !== this.keyVersion) {
      throw new Error(`unknown KYC master-key version: ${version}`);
    }
    return this.masterKey;
  }
}
