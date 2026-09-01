import type {
  IProfileStorageService,
  SignedUploadTarget,
} from '@modules/storage/storage-service.interface';

/**
 * Deterministic in-memory `IProfileStorageService` for the profile-image flow (TOV-30) unit /
 * integration / e2e suites. Backed by a single `Map<path, Buffer>`; buffers are COPIED on store and
 * on return so callers can never mutate the fake's internal state.
 *
 * Mirrors the real Supabase-backed adapter's observable behaviour:
 * - `upload` honours `options.upsert` (default false → throws if the object already exists),
 * - `createSignedUploadUrl` mints a signed PUT target WITHOUT writing bytes (the client PUTs later),
 * - `download` throws when absent (the profile service maps that to `PROFILE_UPLOAD_MISSING`).
 *
 * The `putDirect` / `has` / `keys` / `clear` helpers are test-only (NOT part of the interface): they
 * let a suite simulate the client's direct PUT to the signed URL and assert object presence.
 */
export class FakeProfileStorage implements IProfileStorageService {
  private readonly objects = new Map<string, Buffer>();

  upload(
    path: string,
    buffer: Buffer,
    _contentType: string,
    options?: { upsert?: boolean },
  ): Promise<void> {
    if (this.objects.has(path) && options?.upsert !== true) {
      // Mimics Supabase upsert:false — a second write to an existing key is rejected.
      return Promise.reject(new Error('object exists'));
    }
    this.objects.set(path, Buffer.from(buffer));
    return Promise.resolve();
  }

  createSignedUploadUrl(path: string): Promise<SignedUploadTarget> {
    // No bytes written here — the client PUTs to `signedUrl` later (simulate via `putDirect`).
    return Promise.resolve({
      signedUrl: `https://fake-storage.test/upload/${path}?token=faketoken`,
      token: 'faketoken',
      path,
    });
  }

  getPublicUrl(path: string): string {
    return `https://fake-cdn.test/public/${path}`;
  }

  download(path: string): Promise<Buffer> {
    const buffer = this.objects.get(path);
    if (buffer === undefined) {
      return Promise.reject(new Error(`not found: ${path}`));
    }
    return Promise.resolve(Buffer.from(buffer));
  }

  createTemporaryUrl(path: string): Promise<string> {
    return Promise.resolve(`https://fake-storage.test/signed/${path}`);
  }

  createTemporaryUrls(paths: string[]): Promise<(string | null)[]> {
    return Promise.resolve(paths.map((path) => `https://fake-storage.test/signed/${path}`));
  }

  delete(path: string): Promise<void> {
    this.objects.delete(path);
    return Promise.resolve();
  }

  deleteMany(paths: string[]): Promise<void> {
    for (const path of paths) this.objects.delete(path);
    return Promise.resolve();
  }

  objectSize(path: string): Promise<number | null> {
    const buffer = this.objects.get(path);
    return Promise.resolve(buffer === undefined ? null : buffer.length);
  }

  // --- test-only helpers (NOT part of IProfileStorageService) -------------------------------------

  /** Simulate a client's direct PUT to a signed upload URL: stores bytes, bypassing the upsert check. */
  putDirect(path: string, buffer: Buffer): void {
    this.objects.set(path, Buffer.from(buffer));
  }

  /** True if an object is present at `path`. */
  has(path: string): boolean {
    return this.objects.has(path);
  }

  /** Every stored object path (insertion order). */
  keys(): string[] {
    return [...this.objects.keys()];
  }

  /** Drop all stored objects — reset between tests. */
  clear(): void {
    this.objects.clear();
  }
}
