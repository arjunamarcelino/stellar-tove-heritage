import { createHash } from 'node:crypto';
import { nativeToScVal, xdr } from '@stellar/stellar-sdk';

/**
 * Per-artwork values resolved by the deploy worker and passed to the factory service. The base-infra
 * addresses (proxy_admin, treasury, kyc_allowlist, freeze_set, marketplace_settler, minter, usdc) and
 * the canonical wasm hash come from config inside the service — they are not per-artwork.
 */
export interface TokenInitInput {
  artworkId: string;
  name: string;
  symbol: string;
  /** Artist address; also used as `artist_payout` for MVP. */
  artistAddress: string;
  /** i128 decimal strings (whole tokens; the FractionToken has 0 decimals). */
  artistRetentionAmount: string;
  treasuryRetentionAmount: string;
  /** u64 unix-second timestamps at which each lockup floor releases. */
  artistLockupUntil: string;
  treasuryLockupUntil: string;
}

/** Soroban `artwork_id: BytesN<32>` salt = sha256(uuid). Deterministic + collision-free. */
export function deriveArtworkSalt(artworkId: string): Buffer {
  return createHash('sha256').update(artworkId, 'utf8').digest();
}

/** `floor(totalSupply × pct / 100)` in BigInt so a future max-supply raise can't hit a float cliff. */
export function computeRetentionAmount(totalSupply: string, pct: number): string {
  return ((BigInt(totalSupply) * BigInt(pct)) / 100n).toString();
}

/** Absolute u64 lockup expiry: `deployTsSeconds + days × 86400`. */
export function computeLockupUntil(deployTsSeconds: number, days: number): string {
  return (BigInt(deployTsSeconds) + BigInt(days) * 86_400n).toString();
}

/** The 17 resolved `TokenInit` field values (per-artwork + base-infra), ready to encode. */
export interface TokenInitFields {
  artworkSalt: Buffer;
  name: string;
  symbol: string;
  proxyAdmin: string;
  artist: string;
  artistPayout: string;
  treasury: string;
  artistRetention: bigint;
  artistLockupUntil: bigint;
  treasuryRetention: bigint;
  treasuryLockupUntil: bigint;
  kycAllowlist: string;
  freezeSet: string;
  marketplaceSettler: string;
  minter: string;
  usdc: string;
  implWasmHash: Buffer;
}

/**
 * Encode the `TokenInit` struct as a Soroban `ScMap`. Every field carries an explicit
 * `['symbol', <valueType>]` type entry so ALL 17 keys are `scvSymbol` (a struct decodes only from an
 * all-symbol-keyed map; without the hint `nativeToScVal` emits `scvString` keys and the host rejects it).
 * The SDK auto-sorts the map by key, so declaration order is irrelevant. Pinned by a golden-vector test.
 */
export function encodeTokenInitScVal(t: TokenInitFields): xdr.ScVal {
  return nativeToScVal(
    {
      artwork_id: t.artworkSalt,
      name: t.name,
      symbol: t.symbol,
      proxy_admin: t.proxyAdmin,
      artist: t.artist,
      artist_payout: t.artistPayout,
      treasury: t.treasury,
      artist_retention: t.artistRetention,
      artist_lockup_until: t.artistLockupUntil,
      treasury_retention: t.treasuryRetention,
      treasury_lockup_until: t.treasuryLockupUntil,
      kyc_allowlist: t.kycAllowlist,
      freeze_set: t.freezeSet,
      marketplace_settler: t.marketplaceSettler,
      minter: t.minter,
      usdc: t.usdc,
      impl_wasm_hash: t.implWasmHash,
    },
    {
      type: {
        artwork_id: ['symbol', 'bytes'],
        name: ['symbol', 'string'],
        symbol: ['symbol', 'string'],
        proxy_admin: ['symbol', 'address'],
        artist: ['symbol', 'address'],
        artist_payout: ['symbol', 'address'],
        treasury: ['symbol', 'address'],
        artist_retention: ['symbol', 'i128'],
        artist_lockup_until: ['symbol', 'u64'],
        treasury_retention: ['symbol', 'i128'],
        treasury_lockup_until: ['symbol', 'u64'],
        kyc_allowlist: ['symbol', 'address'],
        freeze_set: ['symbol', 'address'],
        marketplace_settler: ['symbol', 'address'],
        minter: ['symbol', 'address'],
        usdc: ['symbol', 'address'],
        impl_wasm_hash: ['symbol', 'bytes'],
      },
    },
  );
}
