export const KEY_WRAPPER = 'IKeyWrapper';

/** A per-document DEK wrapped by the master KEK, tagged with the master-key version that wrapped it (D2). */
export interface WrappedDek {
  /** iv(12) ‖ authTag(16) ‖ ciphertext(32) — AES-256-GCM, context-bound via AAD (SEC-C1). 60 bytes. */
  wrapped: Buffer;
  /** Positive smallint (1..32767); maps to `kyc_documents.dek_key_version`. */
  keyVersion: number;
}

/**
 * Envelope key-wrapping port. Async NOW (sync impl) so a cloud-KMS adapter — whose Encrypt/Decrypt is
 * network I/O — can drop in without touching any call site (kieran-F1). The `aad` binds a wrapped DEK to
 * its logical row (`userId|submissionId|docType|keyVersion`), so a DB-level DEK/blob row-swap fails to
 * unwrap (SEC-C1).
 */
export interface IKeyWrapper {
  wrapDek(dek: Buffer, aad: string): Promise<WrappedDek>;
  unwrapDek(wrapped: WrappedDek, aad: string): Promise<Buffer>;
}
