export interface IStorageService {
  /**
   * Upload a buffer. `options.upsert` (default false) allows overwriting an existing object — used by the
   * profile-image worker to make derivative generation idempotent on retry; the default keeps the historic
   * fail-if-exists behaviour for every other caller.
   */
  upload(path: string, buffer: Buffer, contentType: string, options?: { upsert?: boolean }): Promise<void>;
  createTemporaryUrl(path: string, expiresIn: number): Promise<string>;
  /**
   * Batch variant of {@link createTemporaryUrl}: signs many paths in ONE round-trip. Fail-open per item —
   * a path that cannot be signed (or a whole-batch failure) yields `null` at that position rather than
   * throwing, so one bad object never sinks the rest. Result is aligned to the input `paths` order.
   */
  createTemporaryUrls(paths: string[], expiresIn: number): Promise<(string | null)[]>;
  delete(path: string): Promise<void>;
}

/** The result of minting a signed upload URL (Supabase `createSignedUploadUrl`). */
export interface SignedUploadTarget {
  signedUrl: string;
  token: string;
  path: string;
}

/**
 * Narrow storage port for the profile-image flow (TOV-30) — mirrors the KYC `IKycStorageService` pattern
 * (keeps signed-upload / public-url / download off the shared `IStorageService` that files/artworks/kyc all
 * depend on). Bound to two buckets via distinct DI tokens (private source, public derivatives).
 */
export interface IProfileStorageService extends IStorageService {
  /** Mint a short-lived signed PUT target for a direct client upload (Supabase fixes the TTL at ~2h). */
  createSignedUploadUrl(path: string): Promise<SignedUploadTarget>;
  /** Stable, unsigned public URL (public bucket only). Pure string build — no network call. */
  getPublicUrl(path: string): string;
  /** Download an object's bytes for server-side validation / derivative generation. Throws if absent. */
  download(path: string): Promise<Buffer>;
  /** Best-effort batch delete (one round-trip per chunk) — used by the reaper. Never throws. */
  deleteMany(paths: string[]): Promise<void>;
  /** Object byte size WITHOUT downloading it (null if absent) — the pre-download size gate at commit. */
  objectSize(path: string): Promise<number | null>;
}
