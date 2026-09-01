import { randomUUID } from 'node:crypto';

/**
 * Shared offering-row seeder for integration + e2e suites. Centralizes the raw `INSERT INTO offerings` column
 * list so a future schema addition ripples through ONE place instead of ~10 hand-rolled inserts across ~7 specs
 * (TOV-165 alone had to touch all of them). Callers pass their own query runner (`ds.query` / a `q` wrapper) and
 * only the fields they care about.
 *
 * The TOV-165 supply/retention snapshot defaults to a decomposition-consistent `total_supply = public_float`,
 * `artist = 0`, `treasury = 0` (so `CHK_off_public_float_decomposition` holds for any `publicFloat`); override
 * them when a test needs non-zero retentions (e.g. to exercise that CHECK).
 *
 * `windowOpenAt`/`windowCloseAt`/`createdAt` accept a `Date` (the node-postgres driver serializes it) or an ISO
 * string; the relative-window defaults (open 2d ago, close 1d ago) match the common "already closed" seed.
 */
/** Any TypeORM query runner (`ds.query`, a `q` wrapper, a queryRunner.query) — non-generic so every spec's
 *  handle is assignable without generic-variance friction; the helper casts the RETURNING row internally. */
export type QueryFn = (text: string, params?: unknown[]) => Promise<unknown[]>;

export interface SeedOfferingOpts {
  artworkId: string;
  fractionContractId: string;
  createdByAdminSub: string;
  id?: string;
  status?: string;
  lowPriceStroops?: string;
  highPriceStroops?: string;
  publicFloat?: string;
  totalSupplyStroops?: string;
  artistRetentionStroops?: string;
  treasuryRetentionStroops?: string;
  windowOpenAt?: string | Date;
  windowCloseAt?: string | Date;
  escrowDeployStatus?: string | null;
  escrowContractAddress?: string | null;
  createdAt?: string | Date;
  /** ON CONFLICT (id) DO NOTHING — for suites that seed a fixed id idempotently across tests. */
  onConflictDoNothing?: boolean;
}

export async function insertOffering(q: QueryFn, opts: SeedOfferingOpts): Promise<string> {
  const id = opts.id ?? randomUUID();
  const publicFloat = opts.publicFloat ?? '850000';
  const rows = (await q(
    `INSERT INTO "offerings" (
       "id", "artwork_id", "fraction_contract_id", "status", "low_price_stroops", "high_price_stroops",
       "public_float", "total_supply_stroops", "artist_retention_stroops", "treasury_retention_stroops",
       "window_open_at", "window_close_at", "created_by_admin_sub", "escrow_deploy_status",
       "escrow_contract_address", "created_at"
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ${opts.onConflictDoNothing ? 'ON CONFLICT ("id") DO NOTHING' : ''}
     RETURNING "id"`,
    [
      id,
      opts.artworkId,
      opts.fractionContractId,
      opts.status ?? 'planned',
      opts.lowPriceStroops ?? '50000000',
      opts.highPriceStroops ?? '150000000',
      publicFloat,
      opts.totalSupplyStroops ?? publicFloat,
      opts.artistRetentionStroops ?? '0',
      opts.treasuryRetentionStroops ?? '0',
      opts.windowOpenAt ?? new Date(Date.now() - 2 * 86_400_000),
      opts.windowCloseAt ?? new Date(Date.now() - 86_400_000),
      opts.createdByAdminSub,
      opts.escrowDeployStatus ?? null,
      opts.escrowContractAddress ?? null,
      opts.createdAt ?? new Date(),
    ],
  )) as Array<{ id: string }>;
  // ON CONFLICT DO NOTHING may RETURN 0 rows; the id is deterministic so fall back to it.
  return rows[0]?.id ?? id;
}
