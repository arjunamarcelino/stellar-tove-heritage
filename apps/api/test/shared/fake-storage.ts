import type { IStorageService } from '@modules/storage/storage-service.interface';

/**
 * Deterministic in-memory `IStorageService` for integration + e2e suites (TOV-189). Implements the real
 * 2-arg `createTemporaryUrl(path, expiresIn)` shape — distinct from `test/shared/in-memory-storage.ts`
 * (`InMemoryStorage`), which implements the different 1-arg `IKycStorageService`. Optionally injects
 * per-path failures so fail-open behavior is exercisable.
 */
export class FakeStorageService implements IStorageService {
  /** Storage paths for which `createTemporaryUrl` should throw (simulates a signing failure). */
  readonly failFor = new Set<string>();

  upload(): Promise<void> {
    return Promise.resolve();
  }

  createTemporaryUrl(path: string, expiresIn: number): Promise<string> {
    if (this.failFor.has(path)) {
      return Promise.reject(new Error(`FakeStorageService: signing failure injected for ${path}`));
    }
    return Promise.resolve(`https://signed.test/${encodeURIComponent(path)}?ttl=${expiresIn}`);
  }

  createTemporaryUrls(paths: string[], expiresIn: number): Promise<(string | null)[]> {
    // Fail-open per item: an injected-failure path signs to null (never throws for the batch).
    return Promise.resolve(
      paths.map((path) =>
        this.failFor.has(path) ? null : `https://signed.test/${encodeURIComponent(path)}?ttl=${expiresIn}`,
      ),
    );
  }

  delete(): Promise<void> {
    return Promise.resolve();
  }
}
