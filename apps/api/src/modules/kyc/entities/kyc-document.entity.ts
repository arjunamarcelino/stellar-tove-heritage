import { Entity, Column } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';
import { KycDocType } from '../enums/kyc-doc-type.enum';

/**
 * One encrypted KYC document (TOV-28, FR-01.07). The plaintext never touches the DB — only the storage
 * key of the AES-256-GCM ciphertext blob, the per-document DEK wrapped by the master KEK (`encrypted_dek`
 * + the `dek_key_version` that wrapped it, D1/D2), and a keyed HMAC of the plaintext (`blob_hash`, SEC-H1).
 * `content_type` is the server-SNIFFED type, never the client-declared one.
 */
@Entity('kyc_documents')
export class KycDocument extends BaseEntity {
  @Column({ name: 'submission_id', type: 'uuid' })
  submissionId!: string;

  @Column({ name: 'doc_type', type: 'varchar', length: 24 })
  docType!: KycDocType;

  /** Object key in the private `tove-kyc` bucket: `{userId}/{submissionId}/{docType}`. */
  @Column({ name: 'storage_key', type: 'text' })
  storageKey!: string;

  /** Per-document DEK, wrapped (AES-256-GCM, context-bound) by the master KEK. */
  @Column({ name: 'encrypted_dek', type: 'bytea' })
  encryptedDek!: Buffer;

  /** Master-key version that wrapped `encrypted_dek` (enables rotation without re-encrypting blobs). */
  @Column({ name: 'dek_key_version', type: 'smallint' })
  dekKeyVersion!: number;

  /** Keyed HMAC-SHA256(plaintext) hex — integrity + de-dup, no offline oracle from a DB-only compromise. */
  @Column({ name: 'blob_hash', type: 'char', length: 64 })
  blobHash!: string;

  @Column({ name: 'content_type', type: 'varchar', length: 64 })
  contentType!: string;

  @Column({ name: 'byte_size', type: 'int' })
  byteSize!: number;
}
