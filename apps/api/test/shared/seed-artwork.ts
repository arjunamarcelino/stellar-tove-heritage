import { randomUUID } from 'node:crypto';

/**
 * Shared artwork-row seeder for integration + e2e suites (TOV-189). Centralizes the raw
 * `INSERT INTO artworks` + `artwork_images` column lists so a future schema addition ripples through ONE
 * place. Callers pass their own query handle (`ds.query` / a `q` wrapper). `artworks.artist_user_id` is a
 * FK to `users` (ON DELETE RESTRICT), so seed a user first via {@link insertArtworkArtist}.
 *
 * `supportingImages` are RAW storage paths (the read path signs them). `sortOrder` defaults to the array
 * index; pass explicit `{ storagePath, sortOrder }` to seed images OUT of order and prove `ORDER BY`.
 */
export type QueryFn = (text: string, params?: unknown[]) => Promise<unknown[]>;

export interface SeedArtworkImage {
  storagePath: string;
  sortOrder: number;
}

export interface SeedArtworkOpts {
  artistUserId: string;
  id?: string;
  status?: string;
  title?: string;
  year?: number | null;
  medium?: string | null;
  dimensions?: string | null;
  artistName?: string | null;
  artistHandle?: string | null;
  primaryImageUrl?: string | null;
  custodian?: string | null;
  coaStoragePath?: string | null;
  supportingImages?: SeedArtworkImage[];
  /** ON CONFLICT (id) DO NOTHING — for suites that seed a fixed id idempotently across tests. */
  onConflictDoNothing?: boolean;
}

/** Insert a minimal `users` row to satisfy the `artworks.artist_user_id` FK. Idempotent. */
export async function insertArtworkArtist(q: QueryFn, id: string): Promise<string> {
  await q(
    `INSERT INTO "users" ("id", "is_active", "kyc_status") VALUES ($1, true, 'not_submitted')
     ON CONFLICT ("id") DO NOTHING`,
    [id],
  );
  return id;
}

export async function insertArtwork(q: QueryFn, opts: SeedArtworkOpts): Promise<string> {
  const id = opts.id ?? randomUUID();
  const rows = (await q(
    `INSERT INTO "artworks" (
       "id", "status", "artist_user_id", "title", "year", "medium", "dimensions",
       "artist_name", "artist_handle", "primary_image_url", "custodian", "coa_storage_path"
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ${opts.onConflictDoNothing ? 'ON CONFLICT ("id") DO NOTHING' : ''}
     RETURNING "id"`,
    [
      id,
      opts.status ?? 'verified',
      opts.artistUserId,
      opts.title ?? 'Northern Lights',
      opts.year ?? 1998,
      opts.medium ?? 'Oil on canvas',
      opts.dimensions ?? '80x120 cm',
      opts.artistName ?? 'Sophie Tove',
      opts.artistHandle ?? 'sophie-tove',
      opts.primaryImageUrl ?? 'https://cdn.tove.test/aw.jpg',
      opts.custodian ?? null,
      opts.coaStoragePath ?? null,
    ],
  )) as Array<{ id: string }>;
  // ON CONFLICT DO NOTHING may RETURN 0 rows; the id is deterministic so fall back to it.
  const artworkId = rows[0]?.id ?? id;

  for (const image of opts.supportingImages ?? []) {
    await q(
      `INSERT INTO "artwork_images" ("artwork_id", "storage_path", "sort_order") VALUES ($1,$2,$3)`,
      [artworkId, image.storagePath, image.sortOrder],
    );
  }
  return artworkId;
}
