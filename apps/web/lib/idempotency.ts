// Fresh v4 idempotency key, shared by the money-flow hooks (bid ceremony + RFQ create). crypto.randomUUID
// is the happy path; a non-secure context throws, so fall back to getRandomValues (or a monotonic counter as
// a last resort) shaped as a valid v4 uuid — the server actions re-validate the key with z.uuid(), so a
// malformed fallback would be rejected as SERVER_ERROR. Extracted from hooks/useBidFlow.ts (todo TOV-173) so
// the security-sensitive fallback bit-twiddling lives once instead of being copied per feature.

let keyCounter = 0;

export function mintIdempotencyKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    const bytes = new Uint8Array(16);
    try {
      crypto.getRandomValues(bytes);
    } catch {
      for (let i = 0; i < 16; i++) bytes[i] = (keyCounter + i * 31 + 1) & 0xff;
      keyCounter++;
    }
    bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10xx
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
      .slice(6, 8)
      .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }
}
