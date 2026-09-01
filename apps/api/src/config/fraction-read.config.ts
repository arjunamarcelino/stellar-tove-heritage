import { registerAs } from '@nestjs/config';
import { Keypair, StrKey } from '@stellar/stellar-sdk';

/**
 * FractionToken balance-read config (TOV-237, FR-04.MVP.04). Powers the simulate-only, bounded-parallel
 * `GET /v1/me/holdings` read. Deliberately holds **no signing secret** — reads never sign. The synthetic
 * simulation source only needs a public key, derived from the existing `FRACTION_RELAYER_SECRET` at boot
 * (the raw seed is not stored). RPC/passphrase reuse the fraction-factory values unless overridden.
 */
/**
 * Derive the synthetic read-source public key from `FRACTION_RELAYER_SECRET` (shared with the fraction
 * factory config, which already `require()`s it). Throws at config-load — and therefore at app boot — if the
 * secret is absent or the derived key isn't a valid ed25519 StrKey, so a misconfigured/partial deploy fails
 * fast rather than serving a permanently-503 holdings endpoint.
 */
function deriveReadSourcePublicKey(): string {
  const secret = process.env.FRACTION_RELAYER_SECRET;
  if (!secret) {
    throw new Error(
      'fraction-read config: FRACTION_RELAYER_SECRET is required to derive the balance-read source public key',
    );
  }
  const publicKey = Keypair.fromSecret(secret).publicKey();
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new Error('fraction-read config: derived read source public key is not a valid ed25519 StrKey');
  }
  return publicKey;
}

export const fractionReadConfig = registerAs('fractionRead', () => ({
  rpcUrl:
    process.env.FRACTION_READ_RPC_URL ??
    process.env.FRACTION_RPC_URL ??
    'https://soroban-testnet.stellar.org',
  networkPassphrase:
    process.env.FRACTION_READ_NETWORK_PASSPHRASE ??
    process.env.FRACTION_NETWORK_PASSPHRASE ??
    'Test SDF Network ; September 2015',
  // Synthetic simulation source (seq 0); balance reads don't consume a sequence, so only the pubkey is
  // needed and the account need not exist. Derived from the fraction relayer seed — no secret retained.
  // Fail fast at boot (todo 253): a missing/invalid source pubkey would otherwise degrade to a SILENT
  // 100%-503 endpoint (every request throws inside readOne → swallowed → 503). Crash-loop instead.
  sourcePublicKey: deriveReadSourcePublicKey(),
  // Bounded fan-out ceiling to keep the read off the RPC 429 cliff as the catalog grows.
  concurrency: parseInt(process.env.FRACTION_READ_CONCURRENCY ?? '8', 10),
  timeoutMs: parseInt(process.env.FRACTION_READ_TIMEOUT_MS ?? '5000', 10),
  // Overall wall-clock budget for the whole bounded fan-out (todo 249). Per-call `timeoutMs` bounds a
  // single hung RPC, but many slow-but-succeeding calls could otherwise accumulate `ceil(N/conc) × timeoutMs`
  // and pin the request. Breaching the budget throws → 503 (complete-or-nothing; never a partial list).
  totalBudgetMs: parseInt(process.env.FRACTION_READ_TOTAL_BUDGET_MS ?? '8000', 10),
  // Warn-only threshold (NOT a cap — the fan-out is never truncated): log when the deployed-contract
  // fan-out approaches this many reads, so the O(catalog) cliff is observed before it hurts (todo 245).
  fanOutWarnThreshold: parseInt(process.env.FRACTION_READ_FANOUT_WARN ?? '200', 10),
  // Per-wallet response cache TTL (seconds).
  cacheTtlSeconds: parseInt(process.env.FRACTION_READ_CACHE_TTL_SECONDS ?? '30', 10),
}));

export type FractionReadConfig = ReturnType<typeof fractionReadConfig>;
