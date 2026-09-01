import { Injectable, Inject, Optional, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { supabaseConfig } from '@config/supabase.config';
import { IProfileStorageService, SignedUploadTarget } from './storage-service.interface';

/**
 * Optional DI token: a second provider (e.g. the private `tove-kyc` bucket, TOV-28) supplies this to bind
 * a `SupabaseStorageService` instance to a bucket other than the configured `files` default. When absent
 * (`@Optional()`), the service uses `supabaseConfig.bucket`. Named token (not a positional primitive) so
 * it can never be satisfied by an unrelated `string` provider and both providers go through DI.
 */
export const STORAGE_BUCKET_OVERRIDE = 'STORAGE_BUCKET_OVERRIDE';

@Injectable()
export class SupabaseStorageService implements IProfileStorageService {
  private readonly logger = new Logger(SupabaseStorageService.name);
  private readonly supabase: SupabaseClient;
  private readonly bucket: string;
  /** Redact object keys in logs for override (dedicated/sensitive) buckets — see {@link logKey}. */
  private readonly redactKeys: boolean;

  constructor(
    @Inject(supabaseConfig.KEY)
    private readonly config: ConfigType<typeof supabaseConfig>,
    @Optional() @Inject(STORAGE_BUCKET_OVERRIDE) bucketOverride?: string,
  ) {
    // SECURITY: This client uses the service role key which bypasses RLS.
    // It must ONLY be used for storage operations.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.supabase = createClient(config.url!, config.serviceRoleKey!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      realtime: {
        transport: WebSocket as unknown as typeof globalThis.WebSocket,
      },
    });
    this.bucket = bucketOverride ?? config.bucket;
    // An override bucket is a dedicated/sensitive one (e.g. KYC, whose object keys embed userId + docType) —
    // redact keys in logs. The default `files` bucket uses non-PII slugs, so keep them logged for debugging.
    this.redactKeys = bucketOverride !== undefined;
  }

  /** A log-safe object key: the full key for non-sensitive buckets, a short hash for override buckets. */
  private logKey(path: string): string {
    return this.redactKeys ? `sha256:${createHash('sha256').update(path).digest('hex').slice(0, 12)}` : path;
  }

  async upload(
    path: string,
    buffer: Buffer,
    contentType: string,
    options?: { upsert?: boolean },
  ): Promise<void> {
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(path, buffer, { contentType, upsert: options?.upsert ?? false });

    if (error) {
      this.logger.error(`Failed to upload file to ${this.logKey(path)}: ${error.message}`);
      throw new InternalServerErrorException('Failed to upload file');
    }
  }

  async createSignedUploadUrl(path: string): Promise<SignedUploadTarget> {
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .createSignedUploadUrl(path);

    if (error || !data?.signedUrl) {
      this.logger.error(`Failed to create signed upload URL for ${this.logKey(path)}: ${error?.message}`);
      throw new InternalServerErrorException('Failed to generate upload URL');
    }

    return { signedUrl: data.signedUrl, token: data.token, path: data.path };
  }

  getPublicUrl(path: string): string {
    // Pure string build — no network call, no error channel (Supabase getPublicUrl is synchronous).
    return this.supabase.storage.from(this.bucket).getPublicUrl(path).data.publicUrl;
  }

  async objectSize(path: string): Promise<number | null> {
    // Read only the object's metadata via list(search) — no bytes transferred. null when absent.
    const slash = path.lastIndexOf('/');
    const dir = slash >= 0 ? path.slice(0, slash) : '';
    const name = slash >= 0 ? path.slice(slash + 1) : path;
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .list(dir, { search: name, limit: 1 });
    if (error || !data || data.length === 0) return null;
    const metadata = data[0].metadata as Record<string, unknown> | null;
    const size = metadata?.size;
    return typeof size === 'number' ? size : null;
  }

  async download(path: string): Promise<Buffer> {
    const { data, error } = await this.supabase.storage.from(this.bucket).download(path);

    if (error || !data) {
      this.logger.error(`Failed to download ${this.logKey(path)}: ${error?.message}`);
      throw new InternalServerErrorException('Failed to download file');
    }

    return Buffer.from(await data.arrayBuffer());
  }

  async createTemporaryUrl(path: string, expiresIn: number): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .createSignedUrl(path, expiresIn);

    if (error || !data?.signedUrl) {
      this.logger.error(`Failed to create signed URL for ${this.logKey(path)}: ${error?.message}`);
      throw new InternalServerErrorException('Failed to generate file URL');
    }

    return data.signedUrl;
  }

  async createTemporaryUrls(paths: string[], expiresIn: number): Promise<(string | null)[]> {
    if (paths.length === 0) return [];

    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .createSignedUrls(paths, expiresIn);

    // Whole-batch failure → fail-open: every position degrades to null (caller decides how to render).
    if (error || !data) {
      this.logger.error(`Failed to batch-create ${paths.length} signed URL(s): ${error?.message}`);
      return paths.map(() => null);
    }

    // `data` is aligned to the input `paths` order; a per-item error/missing url → null at that position.
    return data.map((datum) => (datum.error || !datum.signedUrl ? null : datum.signedUrl));
  }

  async delete(path: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .remove([path]);

    if (error) {
      this.logger.error(`Failed to delete file ${this.logKey(path)}: ${error.message}`);
    }
  }

  async deleteMany(paths: string[]): Promise<void> {
    // Batch remove in chunks (one round-trip each). Best-effort: log and continue (mirrors delete()).
    for (let i = 0; i < paths.length; i += DELETE_CHUNK) {
      const chunk = paths.slice(i, i + DELETE_CHUNK);
      const { error } = await this.supabase.storage.from(this.bucket).remove(chunk);
      if (error) {
        this.logger.error(`Failed to batch-delete ${chunk.length} object(s): ${error.message}`);
      }
    }
  }

  /**
   * Recursively list every object key under `prefix` whose `created_at` is older than `olderThanMs`
   * (the grace window). Supabase `list()` returns one level at a time — folders have `id === null`, files
   * have an `id` + `created_at` — so we walk prefixes. Used by the KYC orphan-blob sweeper (#193).
   */
  async listObjectsOlderThan(prefix: string, olderThanMs: number): Promise<string[]> {
    const cutoff = Date.now() - olderThanMs;
    const keys: string[] = [];
    const walk = async (path: string): Promise<void> => {
      for (let offset = 0; ; offset += LIST_PAGE) {
        const { data, error } = await this.supabase.storage
          .from(this.bucket)
          .list(path, { limit: LIST_PAGE, offset });
        if (error) {
          this.logger.error(`Failed to list ${this.logKey(path)}: ${error.message}`);
          throw new InternalServerErrorException('Failed to list storage objects');
        }
        if (!data || data.length === 0) break;
        for (const item of data) {
          const full = path ? `${path}/${item.name}` : item.name;
          if (item.id === null) {
            await walk(full); // a folder/prefix
          } else if (item.created_at && new Date(item.created_at).getTime() < cutoff) {
            keys.push(full);
          }
        }
        if (data.length < LIST_PAGE) break;
      }
    };
    await walk(prefix);
    return keys;
  }
}

const LIST_PAGE = 100;
const DELETE_CHUNK = 100;
