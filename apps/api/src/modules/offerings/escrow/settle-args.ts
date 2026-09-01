import { nativeToScVal, xdr } from '@stellar/stellar-sdk';

/**
 * The ONE place the `close_and_settle(clearing_price: i128, allocations: Vec<(u32, i128)>)` ABI encoding
 * lives (TOV-160) — sibling to `offering-escrow-args.ts`, golden-vector-pinned by a unit test (the merge
 * gate for the real adapter). Every value carries an explicit `{ type }` hint: a bare `bigint` infers
 * `scvU64`/`scvU128` (UNSIGNED — the host rejects it where i128 is expected), a bare `number` infers
 * `scvU64`, and a bare address-string infers `scvString`.
 *
 * A Rust tuple `(u32, i128)` serializes to an ScVal **Vec** of two elements `[scvU32, scvI128]` (NOT a Map,
 * NOT a struct), so `allocations` is an outer `scvVec` whose every element is an inner 2-element `scvVec`.
 * `bidId` must be a plain `number` (`< 2^32`) — `u32` is special-cased and takes a number, never a bigint.
 */
const U32 = { type: 'u32' } as const;
const I128 = { type: 'i128' } as const;

/** One winner allocation to encode. `bidId` is the on-chain 1-based `submit_bid` id (u32). */
export interface AllocationArg {
  bidId: number;
  allocated: bigint;
}

/** The maximum valid on-chain bid id (u32). */
const MAX_U32 = 4_294_967_295;

/** Encode the i128 uniform clearing price. */
export function encodeClearingPrice(clearingPrice: bigint): xdr.ScVal {
  return nativeToScVal(clearingPrice, I128);
}

/**
 * Encode `Vec<(u32, i128)>`. Asserts each `bidId ∈ [1, 2^32−1]` and each `allocated > 0` BEFORE encoding —
 * a `chain_bid_id` (DB `bigint`) that is null/≤0/≥2^32 would otherwise silently produce a wrong or throwing
 * u32 and settle the wrong bid; bid ids must also be unique across the set.
 */
export function encodeAllocations(allocations: ReadonlyArray<AllocationArg>): xdr.ScVal {
  const seen = new Set<number>();
  for (const { bidId, allocated } of allocations) {
    if (!Number.isInteger(bidId) || bidId < 1 || bidId > MAX_U32) {
      throw new RangeError(`allocation bidId ${bidId} is not a valid u32 in [1, ${MAX_U32}]`);
    }
    if (seen.has(bidId)) {
      throw new RangeError(`duplicate allocation bidId ${bidId}`);
    }
    seen.add(bidId);
    if (allocated <= 0n) {
      throw new RangeError(`allocation for bidId ${bidId} must be positive`);
    }
  }
  return xdr.ScVal.scvVec(
    allocations.map(({ bidId, allocated }) =>
      xdr.ScVal.scvVec([nativeToScVal(bidId, U32), nativeToScVal(allocated, I128)]),
    ),
  );
}
