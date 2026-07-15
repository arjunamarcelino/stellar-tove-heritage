import { Injectable } from '@nestjs/common';
import { IRelayerAccountLock } from './relayer-account-lock.interface';

/**
 * Single-process serialization via a per-key promise chain. Correct for one instance
 * (and used in tests); does NOT serialize across instances — use RedisRelayerAccountLock for that.
 */
@Injectable()
export class InMemoryRelayerAccountLock implements IRelayerAccountLock {
  private readonly chains = new Map<string, Promise<unknown>>();

  withLock<T>(key: string, _ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    // Keep the chain alive regardless of this task's outcome.
    this.chains.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }
}
