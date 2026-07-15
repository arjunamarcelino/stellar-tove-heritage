import { randomUUID } from 'node:crypto';
import type { IdempotencyBegin } from '../../src/common/idempotency/idempotency-store';

/**
 * In-memory stand-in for {@link IdempotencyStore} — same begin/complete/fail contract without Redis, so
 * unit + e2e suites are deterministic and dependency-free (overrides the real provider). Mirrors the
 * `RedisRelayerAccountLock` → `FakeRelayerService` test pattern.
 */
export class InMemoryIdempotencyStore {
  private readonly records = new Map<string, { s: 'pending' | 'done'; f: string; token: string; body?: unknown }>();

  begin(key: string, fingerprint: string): Promise<IdempotencyBegin> {
    const existing = this.records.get(key);
    if (!existing) {
      const token = randomUUID();
      this.records.set(key, { s: 'pending', f: fingerprint, token });
      return Promise.resolve({ outcome: 'proceed', token });
    }
    if (existing.f !== fingerprint) return Promise.resolve({ outcome: 'mismatch' });
    if (existing.s === 'pending') return Promise.resolve({ outcome: 'in_flight' });
    return Promise.resolve({ outcome: 'replay', body: existing.body });
  }

  complete(key: string, token: string, body: unknown): Promise<void> {
    const record = this.records.get(key);
    if (record && record.token === token) {
      record.s = 'done';
      record.body = body;
    }
    return Promise.resolve();
  }

  fail(key: string, token: string): Promise<void> {
    const record = this.records.get(key);
    if (record && record.token === token) this.records.delete(key);
    return Promise.resolve();
  }
}
