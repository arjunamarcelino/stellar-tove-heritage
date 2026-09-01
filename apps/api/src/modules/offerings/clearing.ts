import { MAX_I128, MAX_STROOPS } from '@common/constants/stroops.constant';
import type {
  ClearingAllocationRow,
  ClearingBidSnapshotRow,
} from './entities/offering-clearing-audit.entity';

/**
 * Pure uniform-price clearing algorithm for primary Offerings (TOV-160, FR-05.05). Dependency-free leaf
 * (imports only the sibling money constants + type-only snapshot shapes) — homed at the offerings module
 * ROOT (like `offering-planning.helpers.ts`) because BOTH the backoffice `clearing-preview` read AND the
 * settle worker consume it, so they compute identically. BigInt end to end (stroops exceed 2^53).
 *
 * The contract (`OfferingEscrow.close_and_settle`) is a conservation + no-overcharge BELT, not a
 * correctness oracle — it verifies `Σ allocated == public_float`, each winner `P ≤ bid.price`, and USDC
 * conservation, but NOT that the winners are the highest/earliest bids. Producing the *right* winner set +
 * the *maximal* clearing price is this algorithm's job; `assertClearingInvariants` is the fail-fast belt
 * that mirrors the on-chain guards (and pre-checks the i128 overflow the contract computes unchecked).
 */

/** Platform primary fee, basis points (3%) — matches the contract's compile-time `PLATFORM_FEE_BPS`. */
export const PLATFORM_FEE_BPS = 300n;

/** One `escrowed` bid, the clearing-walk input. Money fields are canonical stroop/count strings. */
export interface ClearingBidInput {
  /** DB row id (UUID) — used only for DB correlation; NO longer the sort tiebreak (see `chainBidId`). */
  id: string;
  /**
   * On-chain 1-based bid id (`submit_bid` return) — the `allocations` key for `close_and_settle` AND the
   * deterministic (not time-fair) FCFS tiebreak under an exact `createdAt` collision (TOV-162 D4′). Unlike
   * the UUID `id`, it is present in `bidsSnapshot`, so the pro-rata dust ordering is independently
   * belt-verifiable. Always set (`>= 1`) for the `escrowed` bids that reach clearing.
   */
  chainBidId: number;
  collectorSub: string;
  priceStroops: string;
  count: string;
  /** ISO-8601 timestamp; sorts lexicographically == chronologically. */
  createdAt: string;
  /** DB STORED `escrow_amount_stroops` (= price × count) held on-chain for this bid. */
  escrowAmountStroops: string;
}

/** A winning bid: what it cleared + its price-delta refund. */
export interface ClearingWinner {
  id: string;
  chainBidId: number;
  collectorSub: string;
  priceStroops: string;
  /** The bid's full requested count — `allocatedCount < count` marks the marginal (partial) winner. */
  count: string;
  /** Fractions won (`> 0`), a canonical string. */
  allocatedCount: string;
  /** `escrow − P·allocated` (`>= 0`) — the USDC returned to the winner at settlement. */
  refundStroops: string;
}

export interface ClearingResult {
  /** The uniform price P every winner pays; `null` when the offering is undersubscribed. */
  clearingPriceStroops: string | null;
  /** `Σ escrowed count == public_float` exactly — a settleable book. */
  fullySubscribed: boolean;
  /** `Σ count` over all escrowed bids. */
  totalDemand: string;
  winners: ClearingWinner[];
  /** `P · Σ allocated` (0 when undersubscribed). */
  proceedsStroops: string;
  /** `floor(proceeds · 300 / 10000)`. */
  platformFeeStroops: string;
  /** `proceeds − platform_fee`. */
  artistNetStroops: string;
  /** The exact sorted-walk input (AC-2: `bids_snapshot` equals this). */
  bidsSnapshot: ClearingBidSnapshotRow[];
}

/** Price band bounds for the P ∈ [low, high] belt. */
export interface ClearingBand {
  lowPriceStroops: string;
  highPriceStroops: string;
}

/**
 * Compute the uniform clearing price and winner allocations. Sorts the book internally by
 * `(price DESC, createdAt ASC, chainBidId ASC)` so the result is independent of caller order (the repo also
 * returns it index-sorted for a no-Sort scan; its DB tail is `id ASC`, a stable-scan detail that no longer
 * mirrors this authoritative dust tiebreak — see D4′). P is the marginal (lowest) winning price: the tier at
 * which cumulative demand from the top first reaches/crosses `publicFloat`.
 *
 * Allocation is tiered (TOV-162 FR-05.05b, over-subscription pro-rata): bids priced **> P** are filled in
 * full; the `remainingFloat` after them is split **pro-rata** among the **== P** bidders,
 * `floor(count · remainingFloat / totalAtClearing)`, and the integer remainder ("dust", `0 … N−1`) is handed
 * out `+1` each FCFS by `(createdAt, chainBidId)`. This is the Hamilton / largest-remainder method with an
 * FCFS residual; `Σ allocated == publicFloat` exactly (the on-chain conservation invariant). Everyone pays P.
 * A `== P` bidder whose pro-rata share floors to 0 and gets no dust is excluded from `winners` (allocated 0
 * is contract-illegal) and is fully refunded as a lost `== P` bid.
 *
 * Undersubscribed (`Σ demand < publicFloat`) → `fullySubscribed:false`, no allocation fabricated.
 * Throws `RangeError` for a non-positive `publicFloat` (a degenerate snapshot that would make an empty book
 * look "fully subscribed" with `P = null`).
 */
export function computeClearing(bids: ClearingBidInput[], publicFloat: bigint): ClearingResult {
  if (publicFloat <= 0n) {
    throw new RangeError('publicFloat must be positive');
  }

  // Defense-in-depth (TOV-162 #343): the pure function self-defends against a non-positive count or a
  // negative price, independent of the caller. A zero/negative count is otherwise a latent over-allocation
  // — a 0-count `== P` bidder that received a dust `+1` would exceed its own count and violate the on-chain
  // `CHK_bid_won_alloc`. The `escrowed` book upstream already enforces positivity via DB CHECKs, so this
  // never fires in production; it makes `computeClearing` safe under any future/less-trusted caller.
  for (const b of bids) {
    if (BigInt(b.count) <= 0n) {
      throw new RangeError(`bid ${b.chainBidId} has a non-positive count`);
    }
    if (BigInt(b.priceStroops) < 0n) {
      throw new RangeError(`bid ${b.chainBidId} has a negative price`);
    }
  }

  // Decorate-once: parse the money strings to BigInt a single time, then sort/partition on the decorated
  // shape. (price DESC, createdAt ASC, chainBidId ASC) — highest price first; earliest first at a price tie;
  // `chainBidId` (present in bidsSnapshot, unlike the UUID `id`) is the deterministic FCFS tiebreak so the
  // pro-rata dust belt can independently verify the ordering (D4′). Comparators stay `-1|0|1` (no `a - b`
  // Number arithmetic on the money path).
  const decorated = bids.map((bid) => ({ bid, price: BigInt(bid.priceStroops), count: BigInt(bid.count) }));
  const sorted = decorated.sort((a, b) => {
    if (a.price !== b.price) return a.price > b.price ? -1 : 1;
    if (a.bid.createdAt !== b.bid.createdAt) return a.bid.createdAt < b.bid.createdAt ? -1 : 1;
    return a.bid.chainBidId < b.bid.chainBidId ? -1 : a.bid.chainBidId > b.bid.chainBidId ? 1 : 0;
  });

  const bidsSnapshot: ClearingBidSnapshotRow[] = sorted.map(({ bid }) => ({
    chainBidId: bid.chainBidId,
    collectorSub: bid.collectorSub,
    priceStroops: bid.priceStroops,
    count: bid.count,
    createdAt: bid.createdAt,
  }));

  const totalDemand = sorted.reduce((acc, s) => acc + s.count, 0n);

  // Undersubscribed → never fabricate an allocation. Redefined for pro-rata: the settleable test is
  // `totalDemand >= publicFloat` (once subscribed, `Σ allocated == publicFloat` holds by construction). The
  // old `cumulative === publicFloat` gate only worked because the marginal walk capped `cumulative`, which
  // the tiered pro-rata pass no longer does.
  if (totalDemand < publicFloat) {
    return {
      clearingPriceStroops: null,
      fullySubscribed: false,
      totalDemand: totalDemand.toString(),
      winners: [],
      proceedsStroops: '0',
      platformFeeStroops: '0',
      artistNetStroops: '0',
      bidsSnapshot,
    };
  }

  // Pass 1a: find P — walk price-tiers from the top accumulating full demand until it reaches/crosses
  // `publicFloat`. P is the CROSSING tier, never above it — the load-bearing invariant that keeps
  // `remainingFloat > 0`.
  let cumulative = 0n;
  let clearingPrice: bigint | null = null;
  for (const s of sorted) {
    if (cumulative >= publicFloat) break;
    clearingPrice = s.price;
    cumulative += s.count;
  }
  if (clearingPrice === null) {
    // Unreachable: subscribed (`totalDemand >= publicFloat > 0`) guarantees the walk crosses the float.
    throw new RangeError('clearing price could not be determined for a subscribed book');
  }
  const P = clearingPrice;

  // Pass 1b: partition by price relative to P. `above` fills in full; `atP` is pro-rata; below-P is a loser
  // and is never materialized.
  const takes: Array<{ bid: ClearingBidInput; allocated: bigint }> = [];
  const atP: Array<{ bid: ClearingBidInput; count: bigint; allocated: bigint }> = [];
  let filledAbove = 0n;
  let totalAtClearing = 0n;
  for (const s of sorted) {
    if (s.price > P) {
      takes.push({ bid: s.bid, allocated: s.count });
      filledAbove += s.count;
    } else if (s.price === P) {
      atP.push({ bid: s.bid, count: s.count, allocated: 0n });
      totalAtClearing += s.count;
    }
  }

  // Pass 1c: pro-rata the clearing tier (ROUND_DOWN via BigInt floor division), then distribute the integer
  // remainder ("dust", `0 … atP.length−1`) `+1` each in the already-sorted (createdAt, chainBidId) order.
  const remainingFloat = publicFloat - filledAbove; // invariant: 0 < remainingFloat <= totalAtClearing
  let allocatedSoFar = 0n;
  for (const a of atP) {
    a.allocated = (a.count * remainingFloat) / totalAtClearing; // BigInt floor (all operands >= 0)
    allocatedSoFar += a.allocated;
  }
  let dust = remainingFloat - allocatedSoFar; // 0 .. atP.length-1
  for (const a of atP) {
    if (dust <= 0n) break;
    // `base_i <= count_i - 1` whenever remainingFloat < totalAtClearing, so this +1 never exceeds the
    // bidder's own count. (When remainingFloat == totalAtClearing every base_i == count_i and dust == 0.)
    a.allocated += 1n;
    dust -= 1n;
  }
  // Winners = above (full) ++ atP where allocated > 0. Exclude zero-allocation clearing bidders HERE
  // (pre-filter, not a post-hoc prune) so the winner set never carries an allocated-0 row.
  for (const a of atP) {
    if (a.allocated > 0n) takes.push({ bid: a.bid, allocated: a.allocated });
  }

  // Pass 2: with P fixed, compute each winner's price-delta refund and the proceeds. P ≤ every winner's
  // price by construction (P is the lowest winning price), so `paid ≤ escrow` and `refund ≥ 0`.
  let proceeds = 0n;
  const winners: ClearingWinner[] = takes.map(({ bid, allocated }) => {
    const paid = P * allocated;
    const refund = BigInt(bid.escrowAmountStroops) - paid;
    proceeds += paid;
    return {
      id: bid.id,
      chainBidId: bid.chainBidId,
      collectorSub: bid.collectorSub,
      priceStroops: bid.priceStroops,
      count: bid.count,
      allocatedCount: allocated.toString(),
      refundStroops: refund.toString(),
    };
  });

  const platformFee = (proceeds * PLATFORM_FEE_BPS) / 10_000n; // BigInt division truncates → floor (proceeds ≥ 0)
  const artistNet = proceeds - platformFee;

  return {
    clearingPriceStroops: P.toString(),
    fullySubscribed: true,
    totalDemand: totalDemand.toString(),
    winners,
    proceedsStroops: proceeds.toString(),
    platformFeeStroops: platformFee.toString(),
    artistNetStroops: artistNet.toString(),
    bidsSnapshot,
  };
}

/** The winners-only `[(chain_bid_id, allocated)]` map for `close_and_settle` / the audit `allocation_map`. */
export function toAllocationMap(result: ClearingResult): ClearingAllocationRow[] {
  return result.winners.map((w) => ({ chainBidId: w.chainBidId, allocatedCount: w.allocatedCount }));
}

/**
 * Fail-fast belt mirroring the on-chain guards — throws `RangeError` (mapped by the caller to a terminal
 * settle failure) BEFORE any money tx. Catches the deterministic failures the money-safety classifier would
 * otherwise mislabel retryable (esp. the unchecked i128 overflow the contract computes on `proceeds`).
 *
 * @param maxBids the MAX_BIDS_PER_OFFERING ceiling (the on-chain `close_and_settle` refunds every active bid
 *   in one atomic tx, so the book has a hard write-ledger-entry limit).
 */
export function assertClearingInvariants(
  result: ClearingResult,
  band: ClearingBand,
  publicFloat: bigint,
  bidCount: number,
  maxBids: number,
): asserts result is ClearingResult & { clearingPriceStroops: string } {
  if (bidCount > maxBids) {
    throw new RangeError(`escrowed bid count ${bidCount} exceeds MAX_BIDS_PER_OFFERING ${maxBids}`);
  }
  if (!result.fullySubscribed || result.clearingPriceStroops === null) {
    throw new RangeError('offering is not fully subscribed — cannot settle');
  }
  const P = BigInt(result.clearingPriceStroops);
  const low = BigInt(band.lowPriceStroops);
  const high = BigInt(band.highPriceStroops);
  if (P <= 0n || P > MAX_STROOPS) {
    throw new RangeError('clearing price out of stroop range');
  }
  if (P < low || P > high) {
    throw new RangeError(`clearing price ${P} outside band [${low}, ${high}]`);
  }

  let sumAllocated = 0n;
  let proceeds = 0n;
  for (const w of result.winners) {
    const allocated = BigInt(w.allocatedCount);
    if (allocated <= 0n) {
      throw new RangeError('winner has non-positive allocation');
    }
    const paid = P * allocated;
    if (paid > MAX_I128) {
      throw new RangeError('winner paid amount overflows i128');
    }
    if (BigInt(w.refundStroops) < 0n) {
      throw new RangeError('winner refund is negative (clearing price above bid price)');
    }
    sumAllocated += allocated;
    proceeds += paid;
    if (proceeds > MAX_I128) {
      throw new RangeError('proceeds overflow i128');
    }
  }
  if (sumAllocated !== publicFloat) {
    throw new RangeError(`Σ allocated ${sumAllocated} != public_float ${publicFloat}`);
  }
  const expectedFee = (proceeds * PLATFORM_FEE_BPS) / 10_000n;
  if (BigInt(result.platformFeeStroops) !== expectedFee) {
    throw new RangeError('platform fee is not the floor split of proceeds');
  }
  if (BigInt(result.artistNetStroops) !== proceeds - expectedFee) {
    throw new RangeError('artist net is not proceeds minus platform fee');
  }

  // Independent uniform-price OPTIMALITY belt (TOV-160 #327): the on-chain contract is a conservation belt,
  // not a correctness oracle — it accepts any P ≤ each winner's price and any winner set summing to the float.
  // These two checks catch a `computeClearing` regression that produced a too-low P or a suboptimal winner set
  // (which would settle a contract-valid but economically-wrong result and underpay the artist):
  //   (1) P must equal the MARGINAL (minimum) winning price;
  //   (2) every LOSING bid must have priced at or below P (else it should have won).
  let minWinnerPrice: bigint | null = null;
  const winnerBidIds = new Set<number>();
  for (const w of result.winners) {
    winnerBidIds.add(w.chainBidId);
    const wp = BigInt(w.priceStroops);
    if (minWinnerPrice === null || wp < minWinnerPrice) minWinnerPrice = wp;
  }
  if (minWinnerPrice !== P) {
    throw new RangeError(`clearing price ${P} is not the marginal winning price ${String(minWinnerPrice)}`);
  }
  for (const b of result.bidsSnapshot) {
    if (!winnerBidIds.has(b.chainBidId) && BigInt(b.priceStroops) > P) {
      throw new RangeError(`losing bid ${b.chainBidId} priced ${b.priceStroops} above the clearing price ${P}`);
    }
  }

  // Independent PRO-RATA belt (TOV-162 FR-05.05b): the contract verifies `Σ allocated == float` and each
  // winner `P ≤ bid.price`, but NOT that the float was split pro-rata among the `== P` bidders — an
  // intra-tier misallocation (dust to the wrong equal-price bidder, or a `> P` bid under-filled) is
  // contract-VALID yet economically wrong. Re-derive the marginal-tier allocation from the frozen
  // `bidsSnapshot` and assert `winners` match. This derivation is INLINE and does NOT call the production
  // pro-rata code — sharing it would make "recompute-and-compare" compare a value with itself.
  const winnerAlloc = new Map<number, bigint>();
  for (const w of result.winners) winnerAlloc.set(w.chainBidId, BigInt(w.allocatedCount));

  // (a) every `> P` bid must be a winner filled in full; accumulate the `== P` tier + `filledAbove`.
  // NB this is a STRONGER, intentionally-redundant restatement of the optimality belt's "loser priced > P"
  // check above (it also rejects a present-but-under-filled `> P` winner, which that loop skips). Both are
  // kept: two independently-derived belts with distinct error messages on the money path (TOV-162 #341).
  let filledAbove = 0n;
  let totalAtClearing = 0n;
  const atClearing: ClearingBidSnapshotRow[] = [];
  for (const b of result.bidsSnapshot) {
    const bp = BigInt(b.priceStroops);
    const count = BigInt(b.count);
    if (bp > P) {
      filledAbove += count;
      if (winnerAlloc.get(b.chainBidId) !== count) {
        throw new RangeError(`above-clearing bid ${b.chainBidId} is not fully filled`);
      }
    } else if (bp === P) {
      totalAtClearing += count;
      atClearing.push(b);
    }
  }
  if (totalAtClearing <= 0n) {
    throw new RangeError('no bid at the clearing price (corrupt snapshot)');
  }
  const remainingFloat = publicFloat - filledAbove;
  if (remainingFloat <= 0n || remainingFloat > totalAtClearing) {
    throw new RangeError(`remaining float ${remainingFloat} outside (0, ${totalAtClearing}]`);
  }
  // The belt does its OWN (createdAt, chainBidId) sort — not trusting the snapshot's stored order — so a
  // production sort bug cannot reproduce identically here and pass.
  const atClearingSorted = [...atClearing].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.chainBidId < b.chainBidId ? -1 : a.chainBidId > b.chainBidId ? 1 : 0;
  });
  const bases = atClearingSorted.map((b) => (BigInt(b.count) * remainingFloat) / totalAtClearing);
  const dust = remainingFloat - bases.reduce((acc, x) => acc + x, 0n);
  if (dust < 0n || dust >= BigInt(atClearingSorted.length)) {
    throw new RangeError(`dust ${dust} outside [0, ${atClearingSorted.length - 1}]`);
  }
  // (b) each `== P` winner ∈ {floor(base), floor(base)+1}; (c) the `+1` recipients are EXACTLY the earliest
  // `dust` bidders by (createdAt, chainBidId). A zero-derived-allocation bidder must be excluded from winners.
  atClearingSorted.forEach((b, i) => {
    const expected = bases[i] + (BigInt(i) < dust ? 1n : 0n);
    const actual = winnerAlloc.get(b.chainBidId);
    if (expected === 0n) {
      if (actual !== undefined) {
        throw new RangeError(`clearing bid ${b.chainBidId} should be excluded (zero pro-rata allocation)`);
      }
    } else if (actual !== expected) {
      throw new RangeError(`clearing bid ${b.chainBidId} allocated ${String(actual)} != pro-rata ${expected}`);
    }
  });
}
