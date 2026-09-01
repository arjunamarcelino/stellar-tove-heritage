import { randomUUID } from 'node:crypto';

/**
 * Shared marketplace seeders (TOV-175 #380) — used by the quote integration + e2e suites so the
 * artwork/contract/RFQ INSERTs live in one place and can't drift. Mirrors the `test/shared/seed-offering.ts`
 * convention: pass any query handle (`ds.query` or a `q` wrapper) that returns rows as an array.
 */

export const SEED_CONTRACT_ADDR = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const SEED_ARTIST_ADDR = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
const SEED_WASM = '7ad8c08d6e4d72dafba21c1b27b8908e974d725a46aa354491185ae6f26947cd';

export type QueryFn = <T = unknown>(text: string, params?: unknown[]) => Promise<T[]>;

/** Seed a user → fractionalized artwork → deployed fraction_contract. Returns the artwork + contract ids. */
export async function seedArtworkWithContract(q: QueryFn): Promise<{ artworkId: string; contractId: string }> {
  const users = await q<{ id: string }>(
    `INSERT INTO users (is_active, kyc_status) VALUES (true, 'not_submitted') RETURNING id`,
  );
  const artworks = await q<{ id: string }>(
    `INSERT INTO artworks (status, artist_user_id, title) VALUES ('fractionalized', $1, 'A') RETURNING id`,
    [users[0].id],
  );
  const contracts = await q<{ id: string }>(
    `INSERT INTO fraction_contracts (
       artwork_id, status, token_address, wasm_hash, token_name, token_symbol, artist_address,
       total_supply, artist_retention_pct, treasury_retention_pct,
       artist_retention_amount, treasury_retention_amount, artist_lockup_days, treasury_lockup_days
     ) VALUES ($1, 'deployed', $2, $3, 'ArtToken', 'ART', $4,
       '1000000', 10, 5, '100000', '50000', 365, 730) RETURNING id`,
    [artworks[0].id, SEED_CONTRACT_ADDR, SEED_WASM, SEED_ARTIST_ADDR],
  );
  return { artworkId: artworks[0].id, contractId: contracts[0].id };
}

export interface RfqSeed {
  collectorSub?: string;
  status?: string;
  createdAt?: string;
  expiresAt?: string;
}

/** Seed a parent RFQ (default: open, random buyer, 48h expiry) on the artwork/contract. Returns its id. */
export async function seedOpenRfq(
  q: QueryFn,
  artworkId: string,
  contractId: string,
  o: RfqSeed = {},
): Promise<string> {
  const cols = ['collector_sub', 'artwork_id', 'fraction_contract_id', 'fraction_count',
    'max_price_per_fraction_stroops', 'expires_at', 'status', 'idempotency_key_hash'];
  const vals: unknown[] = [
    o.collectorSub ?? randomUUID(), artworkId, contractId, '100', '150000000',
    o.expiresAt ?? new Date(Date.now() + 48 * 3_600_000).toISOString(), o.status ?? 'open',
    Buffer.from(randomUUID().replace(/-/g, '') + '0'.repeat(32)).subarray(0, 32),
  ];
  if (o.createdAt) {
    cols.push('created_at');
    vals.push(o.createdAt);
  }
  const ph = vals.map((_, i) => `$${i + 1}`).join(',');
  const rows = await q<{ id: string }>(
    `INSERT INTO rfqs (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${ph}) RETURNING id`,
    vals,
  );
  return rows[0].id;
}

export interface QuoteSeed {
  holderSub?: string;
  count?: string;
  price?: string;
  validUntil?: string;
  status?: string;
  createdAt?: string;
  /** When true, stamps the seller-authorization columns (TOV-177) so the quote is "acceptable". */
  authorized?: boolean;
  idempotencyKeyHash?: Buffer;
}

/** Seed a quote (default: open, unauthorized, 24h validity, random holder) on the given RFQ. Returns its id. */
export async function seedQuote(
  q: QueryFn,
  rfqId: string,
  contractId: string,
  o: QuoteSeed = {},
): Promise<string> {
  // Each entry is a param placeholder; `authorized_at` alone is a `now()` literal, appended after the params.
  const cols = ['rfq_id', 'holder_sub', 'fraction_contract_id', 'fraction_count',
    'price_per_fraction_stroops', 'valid_until', 'status', 'idempotency_key_hash'];
  const vals: unknown[] = [
    rfqId,
    o.holderSub ?? randomUUID(),
    contractId,
    o.count ?? '10',
    o.price ?? '150000000',
    o.validUntil ?? new Date(Date.now() + 24 * 3_600_000).toISOString(),
    o.status ?? 'open',
    o.idempotencyKeyHash ?? Buffer.from(randomUUID().replace(/-/g, '') + '0'.repeat(32)).subarray(0, 32),
  ];
  if (o.createdAt) {
    cols.push('created_at');
    vals.push(o.createdAt);
  }
  if (o.authorized) {
    cols.push('seller_auth_entry', 'seller_auth_expires_ledger', 'seller_wallet_contract');
    vals.push(Buffer.from('signed-seller-auth-entry-xdr'), '9999999', SEED_CONTRACT_ADDR);
  }
  const valueClauses = vals.map((_, i) => `$${i + 1}`);
  if (o.authorized) {
    cols.push('authorized_at');
    valueClauses.push('now()');
  }
  const rows = await q<{ id: string }>(
    `INSERT INTO rfq_quotes (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${valueClauses.join(',')}) RETURNING id`,
    vals,
  );
  return rows[0].id;
}
