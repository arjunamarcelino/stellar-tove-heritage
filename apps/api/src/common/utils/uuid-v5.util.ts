import { createHash } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

/**
 * RFC 4122 v5 (name-based, SHA-1) UUID. Deterministic: the same (name, namespace) always yields the same
 * UUID. Used to derive a stable uuid subject_id from a non-uuid business key (e.g. a wallet StrKey) so it
 * fits a `uuid` column while still grouping records by that key (TOV-241, todo 267).
 *
 * @param name       the value to hash (UTF-8)
 * @param namespace  a UUID string that scopes the name
 */
export function uuidV5(name: string, namespace: string): string {
  if (!UUID_RE.test(namespace)) {
    throw new Error('uuidV5: namespace must be a valid UUID');
  }
  const hash = createHash('sha1')
    .update(uuidToBytes(namespace))
    .update(Buffer.from(name, 'utf8'))
    .digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
