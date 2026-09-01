import { describe, it, expect } from 'vitest';
import {
  ClearingBidInput,
  assertClearingInvariants,
  computeClearing,
  toAllocationMap,
} from '../../../../src/modules/offerings/clearing';

/** Build a clearing input; escrow = price × count. `t` seeds the ISO createdAt (order within a price level). */
function bid(
  chainBidId: number,
  price: bigint,
  count: bigint,
  t = 1,
  id = `id-${chainBidId}`,
): ClearingBidInput {
  return {
    id,
    chainBidId,
    collectorSub: `sub-${chainBidId}`,
    priceStroops: price.toString(),
    count: count.toString(),
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, t)).toISOString(),
    escrowAmountStroops: (price * count).toString(),
  };
}

const BAND = { lowPriceStroops: '1', highPriceStroops: '1000000000' };
const MAX_BIDS = 40;

describe('computeClearing — uniform-price walk', () => {
  it('U1 golden AC: float 1000, A@150×400 B@120×500 C@100×300 D@80×200 → P=100, A/B full, C=100, D loses', () => {
    // shuffled input order to prove internal sort
    const bids = [
      bid(3, 100n, 300n, 3),
      bid(1, 150n, 400n, 1),
      bid(4, 80n, 200n, 4),
      bid(2, 120n, 500n, 2),
    ];
    const r = computeClearing(bids, 1000n);
    expect(r.fullySubscribed).toBe(true);
    expect(r.clearingPriceStroops).toBe('100');
    expect(r.winners.map((w) => [w.chainBidId, w.allocatedCount])).toEqual([
      [1, '400'],
      [2, '500'],
      [3, '100'], // marginal, partial
    ]);
    expect(r.winners.find((w) => w.chainBidId === 4)).toBeUndefined(); // D loses
    // Everyone pays P=100 → proceeds = 100 * (400+500+100) = 100000.
    expect(r.proceedsStroops).toBe('100000');
    expect(r.platformFeeStroops).toBe('3000'); // floor(100000 * 300 / 10000)
    expect(r.artistNetStroops).toBe('97000');
    expect(r.totalDemand).toBe('1400');
  });

  it("U1b winner refunds: each winner's price-delta = escrow − P·allocated", () => {
    const r = computeClearing([bid(1, 150n, 400n, 1), bid(2, 100n, 600n, 2)], 1000n);
    // P = 100. A: escrow 150*400=60000, paid 100*400=40000 → refund 20000. B: escrow 60000, paid 60000 → 0.
    expect(r.winners[0].refundStroops).toBe('20000');
    expect(r.winners[1].refundStroops).toBe('0');
  });

  it('U2′ pro-rata at the marginal price: equal counts split evenly (was time-priority [60,40])', () => {
    // float 100; two @100 count 60 (total 120) → floor(60·100/120)=50 each, dust 0.
    const r = computeClearing([bid(2, 100n, 60n, 2), bid(1, 100n, 60n, 1)], 100n);
    expect(r.winners.map((w) => [w.chainBidId, w.allocatedCount])).toEqual([
      [1, '50'],
      [2, '50'],
    ]);
  });

  it('U3 exact boundary on a full bid: next bid loses, no partial', () => {
    const r = computeClearing([bid(1, 100n, 600n, 1), bid(2, 90n, 400n, 2), bid(3, 80n, 100n, 3)], 1000n);
    expect(r.winners.map((w) => w.chainBidId)).toEqual([1, 2]);
    expect(r.winners[1].allocatedCount).toBe('400'); // full, not partial
    expect(r.clearingPriceStroops).toBe('90');
  });

  it('U4 single bid ≥ float: partial-fills its own count at its price', () => {
    const r = computeClearing([bid(1, 50n, 5000n, 1)], 1000n);
    expect(r.fullySubscribed).toBe(true);
    expect(r.clearingPriceStroops).toBe('50');
    expect(r.winners).toHaveLength(1);
    expect(r.winners[0].allocatedCount).toBe('1000');
  });

  it('U5 undersubscribed: Σ count < float → fullySubscribed:false, no allocation', () => {
    const r = computeClearing([bid(1, 100n, 300n, 1), bid(2, 90n, 200n, 2)], 1000n);
    expect(r.fullySubscribed).toBe(false);
    expect(r.clearingPriceStroops).toBeNull();
    expect(r.winners).toEqual([]);
    expect(r.proceedsStroops).toBe('0');
    expect(r.totalDemand).toBe('500');
  });

  it('U5b empty book → undersubscribed (never "fully subscribed" with a null price)', () => {
    const r = computeClearing([], 1000n);
    expect(r.fullySubscribed).toBe(false);
    expect(r.clearingPriceStroops).toBeNull();
    expect(r.totalDemand).toBe('0');
  });

  it('U6′ all-equal price: pro-rata split, dust +1 to earliest (was time-priority [400,400,200])', () => {
    // REGRESSION for the TOV-160→162 behavior change (kept for that reason; the general dust-1 case is PR2).
    // three @100 count 400 (total 1200), float 1000 → floor(400·1000/1200)=333 each (=999), dust 1 → +1 to bid1.
    const r = computeClearing(
      [bid(1, 100n, 400n, 1), bid(2, 100n, 400n, 2), bid(3, 100n, 400n, 3)],
      1000n,
    );
    expect(r.winners.map((w) => [w.chainBidId, w.allocatedCount])).toEqual([
      [1, '334'],
      [2, '333'],
      [3, '333'],
    ]);
    expect(r.clearingPriceStroops).toBe('100');
  });

  it('U9 BigInt discipline: near-MAX_STROOPS prices/counts stay exact (no overflow)', () => {
    const big = 79228162514264337593543950335n; // 2^96-1
    const r = computeClearing([bid(1, big, 1n, 1), bid(2, big - 1n, 1n, 2)], 2n);
    expect(r.clearingPriceStroops).toBe((big - 1n).toString());
    // proceeds = P*2 = (2^96-2)*2
    expect(r.proceedsStroops).toBe(((big - 1n) * 2n).toString());
  });

  it('U10′ chainBidId tiebreak: identical price AND createdAt → dust +1 goes to lower chainBidId', () => {
    // float 99; two @100 count 50 (total 100), same createdAt → floor(50·99/100)=49 each (=98), dust 1.
    // The tiebreak is now chainBidId (present in bidsSnapshot), not the UUID id → bid 1 wins the +1.
    const t = 5;
    const r = computeClearing([bid(2, 100n, 50n, t), bid(1, 100n, 50n, t)], 99n);
    expect(r.winners.map((w) => [w.chainBidId, w.allocatedCount])).toEqual([
      [1, '50'],
      [2, '49'],
    ]);
  });

  it('PR1 golden even split: tier [250,150,100], remaining 200 → [100,60,40], dust 0', () => {
    const r = computeClearing([bid(1, 100n, 250n, 1), bid(2, 100n, 150n, 2), bid(3, 100n, 100n, 3)], 200n);
    expect(r.clearingPriceStroops).toBe('100');
    expect(r.winners.map((w) => [w.chainBidId, w.allocatedCount])).toEqual([
      [1, '100'],
      [2, '60'],
      [3, '40'],
    ]);
  });

  it('PR2 dust 1 → +1 to the earliest by (createdAt, chainBidId)', () => {
    // tier [200,167,133], remaining 200, total 500 → floors [80,66,53]=199, dust 1 → bid1.
    const r = computeClearing([bid(1, 100n, 200n, 1), bid(2, 100n, 167n, 2), bid(3, 100n, 133n, 3)], 200n);
    expect(r.winners.map((w) => [w.chainBidId, w.allocatedCount])).toEqual([
      [1, '81'],
      [2, '66'],
      [3, '53'],
    ]);
  });

  it('PR3+PR6 max dust + mass exclusion + fairness inversion (all floors 0): earlier count-2 beats later count-3', () => {
    // tier counts [2,3,3,2] in createdAt order, remaining 2, total 10 → every floor 0, dust 2 → two earliest win 1.
    const r = computeClearing(
      [bid(1, 100n, 2n, 1), bid(2, 100n, 3n, 2), bid(3, 100n, 3n, 3), bid(4, 100n, 2n, 4)],
      2n,
    );
    expect(r.winners.map((w) => [w.chainBidId, w.allocatedCount])).toEqual([
      [1, '1'],
      [2, '1'],
    ]);
    // bid 3 (count 3, later) loses to bid 1 (count 2, earlier); bid 4 also excluded.
    expect(r.winners.find((w) => w.chainBidId === 3)).toBeUndefined();
    expect(r.winners.find((w) => w.chainBidId === 4)).toBeUndefined();
  });

  it('PR4 zero-alloc clearing bidder excluded from winners + fully refunded (lost ==P)', () => {
    // tier [3,3,1], remaining 4, total 7 → floors [1,1,0], dust 2 → [2,2,0]; the count-1 bidder wins 0.
    const r = computeClearing([bid(1, 100n, 3n, 1), bid(2, 100n, 3n, 2), bid(3, 100n, 1n, 3)], 4n);
    expect(r.winners.map((w) => [w.chainBidId, w.allocatedCount])).toEqual([
      [1, '2'],
      [2, '2'],
    ]);
    expect(r.winners.find((w) => w.chainBidId === 3)).toBeUndefined();
    // The belt must accept a zero-alloc loser priced exactly P (loser check is strict `> P`).
    expect(() => assertClearingInvariants(r, BAND, 4n, 3, MAX_BIDS)).not.toThrow();
  });

  it('PR5 above-clearing untouched: > P bid filled in full, price-delta refund; ==P tier pro-rata', () => {
    // bid1 @150 (> P) full; float 250, P=100, remaining 150 over [300,300] → 75 each.
    const r = computeClearing([bid(1, 150n, 100n, 1), bid(2, 100n, 300n, 2), bid(3, 100n, 300n, 3)], 250n);
    expect(r.clearingPriceStroops).toBe('100');
    // [chainBidId, allocatedCount, refundStroops] — avoids a non-null-asserted `.find(...)!`.
    expect(r.winners.map((w) => [w.chainBidId, w.allocatedCount, w.refundStroops])).toEqual([
      [1, '100', '5000'], //  > P → full; refund = (150−100)·100
      [2, '75', '22500'], //  300 requested, 75 allocated; refund = 100·300 − 100·75
      [3, '75', '22500'],
    ]);
  });

  it('PR7 exact-tier boundary: remainingFloat == totalAtClearing → full-fill degenerate, dust 0', () => {
    const r = computeClearing([bid(1, 150n, 400n, 1), bid(2, 100n, 300n, 2), bid(3, 100n, 300n, 3)], 1000n);
    expect(r.clearingPriceStroops).toBe('100');
    expect(r.winners.map((w) => [w.chainBidId, w.allocatedCount])).toEqual([
      [1, '400'],
      [2, '300'],
      [3, '300'],
    ]);
  });

  // (PR8 removed — its all-@P dust-0 proportional-split case is already covered by PR1 [250,150,100]→[100,60,40]. #342)

  it('PR9 remaining == 1, many tiny tier bidders → exactly one winner (earliest), rest excluded', () => {
    const r = computeClearing([bid(1, 100n, 10n, 1), bid(2, 100n, 10n, 2), bid(3, 100n, 10n, 3)], 1n);
    expect(r.winners.map((w) => [w.chainBidId, w.allocatedCount])).toEqual([[1, '1']]);
  });

  it('PR11 BigInt discipline: multi-bidder tier near MAX_STROOPS stays exact', () => {
    const big = 79228162514264337593543950335n; // 2^96-1
    // two @big count 1, float 2 → remaining==total → 1 each; proceeds = big·2.
    const r = computeClearing([bid(1, big, 1n, 1), bid(2, big, 1n, 2)], 2n);
    expect(r.winners.map((w) => w.allocatedCount)).toEqual(['1', '1']);
    expect(r.proceedsStroops).toBe((big * 2n).toString());
  });

  it('PR12 remaining == total − 1: the last-priority bidder absorbs the one-unit loss', () => {
    // tier [2,3,5] total 10, remaining 9 → floors [1,2,4]=7, dust 2 → +1 to bid1,bid2 → [2,3,4]; bid3 = 5−1.
    const r = computeClearing([bid(1, 100n, 2n, 1), bid(2, 100n, 3n, 2), bid(3, 100n, 5n, 3)], 9n);
    expect(r.winners.map((w) => [w.chainBidId, w.allocatedCount])).toEqual([
      [1, '2'],
      [2, '3'],
      [3, '4'],
    ]);
  });

  it('PR-FUZZ property test: conservation + no-over-allocation + belt passes over randomized books', () => {
    // Seeded LCG (Date.now/Math.random are avoided for determinism).
    let seed = 0x2f6e2b1;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let iter = 0; iter < 300; iter++) {
      const numBids = 2 + rnd(8);
      const bids: ClearingBidInput[] = [];
      let totalDemand = 0n;
      for (let i = 0; i < numBids; i++) {
        const price = BigInt(100 + rnd(3) * 10); // 3 distinct tiers → forces ties at the margin
        const count = BigInt(1 + rnd(50));
        totalDemand += count;
        bids.push(bid(i + 1, price, count, rnd(numBids))); // createdAt collisions exercised via shared t
      }
      const publicFloat = BigInt(1 + rnd(Number(totalDemand))); // 1 <= float <= totalDemand → subscribed
      const r = computeClearing(bids, publicFloat);
      expect(r.fullySubscribed).toBe(true);
      const sumAlloc = r.winners.reduce((acc, w) => acc + BigInt(w.allocatedCount), 0n);
      expect(sumAlloc).toBe(publicFloat); // conservation
      for (const w of r.winners) {
        expect(BigInt(w.allocatedCount) > 0n).toBe(true); // no zero winners
        expect(BigInt(w.allocatedCount) <= BigInt(w.count)).toBe(true); // no over-allocation
      }
      // The independent belt agrees with the production allocation on every generated book.
      expect(() => assertClearingInvariants(r, BAND, publicFloat, numBids, 100)).not.toThrow();
    }
  });

  it('throws on a non-positive publicFloat (degenerate snapshot)', () => {
    expect(() => computeClearing([bid(1, 100n, 100n)], 0n)).toThrow(RangeError);
  });

  it('#343 defense-in-depth: rejects a non-positive count or a negative price', () => {
    // zero count would be a latent over-allocation if it reached the ==P tier and drew a dust +1.
    expect(() => computeClearing([bid(1, 100n, 0n)], 100n)).toThrow(/non-positive count/);
    expect(() => computeClearing([bid(1, 100n, -5n)], 100n)).toThrow(/non-positive count/);
    expect(() => computeClearing([bid(1, -1n, 100n)], 100n)).toThrow(/negative price/);
  });

  it('toAllocationMap returns winners-only (chainBidId, allocatedCount)', () => {
    const r = computeClearing([bid(1, 150n, 400n, 1), bid(2, 100n, 600n, 2), bid(3, 80n, 100n, 3)], 1000n);
    expect(toAllocationMap(r)).toEqual([
      { chainBidId: 1, allocatedCount: '400' },
      { chainBidId: 2, allocatedCount: '600' },
    ]);
  });
});

describe('assertClearingInvariants — fail-fast belt', () => {
  const good = () =>
    computeClearing([bid(1, 150n, 400n, 1), bid(2, 100n, 600n, 2), bid(3, 80n, 100n, 3)], 1000n);

  it('U8 passes a valid clearing with P inside the band and Σ allocated == float', () => {
    expect(() => assertClearingInvariants(good(), BAND, 1000n, 3, MAX_BIDS)).not.toThrow();
  });

  it('rejects an undersubscribed result', () => {
    const r = computeClearing([bid(1, 100n, 300n, 1)], 1000n);
    expect(() => assertClearingInvariants(r, BAND, 1000n, 1, MAX_BIDS)).toThrow(/not fully subscribed/);
  });

  it('rejects a clearing price above the band high', () => {
    expect(() => assertClearingInvariants(good(), { lowPriceStroops: '1', highPriceStroops: '99' }, 1000n, 3, MAX_BIDS)).toThrow(/outside band/);
  });

  it('rejects a book larger than MAX_BIDS_PER_OFFERING', () => {
    expect(() => assertClearingInvariants(good(), BAND, 1000n, 41, 40)).toThrow(/MAX_BIDS_PER_OFFERING/);
  });

  it('rejects when Σ allocated != public_float', () => {
    expect(() => assertClearingInvariants(good(), BAND, 999n, 3, MAX_BIDS)).toThrow(/!= public_float/);
  });

  it('#327 rejects a losing bid priced above the clearing price (suboptimal winner set)', () => {
    const r = good(); // P=100, winners bids 1+2, loser bid 3 @ 80
    const bad = {
      ...r,
      bidsSnapshot: [
        ...r.bidsSnapshot,
        { chainBidId: 99, collectorSub: 'x', priceStroops: '200', count: '10', createdAt: '2026-01-01T00:00:09.000Z' },
      ],
    };
    expect(() => assertClearingInvariants(bad, BAND, 1000n, 3, MAX_BIDS)).toThrow(/above the clearing price/);
  });

  it('B1 pro-rata belt rejects a clearing winner allocated below its pro-rata share', () => {
    // tier [300,300], float 400 → 200 each. Tamper: [199, 201] (Σ still 400, both in {200,201}? 199 is below).
    const r = computeClearing([bid(1, 100n, 300n, 1), bid(2, 100n, 300n, 2)], 400n);
    const bad = {
      ...r,
      winners: r.winners.map((w) =>
        w.chainBidId === 1 ? { ...w, allocatedCount: '199' } : { ...w, allocatedCount: '201' },
      ),
    };
    expect(() => assertClearingInvariants(bad, BAND, 400n, 2, MAX_BIDS)).toThrow(/!= pro-rata/);
  });

  it('B2 pro-rata belt rejects dust handed to a later bidder (the load-bearing reshuffle check)', () => {
    // float 99; two @100 count 50 → floors [49,49], dust 1 → bid1 (earliest). Tamper: give the +1 to bid2.
    const r = computeClearing([bid(1, 100n, 50n, 5), bid(2, 100n, 50n, 5)], 99n);
    const bad = {
      ...r,
      winners: r.winners.map((w) =>
        w.chainBidId === 1 ? { ...w, allocatedCount: '49' } : { ...w, allocatedCount: '50' },
      ),
    };
    expect(() => assertClearingInvariants(bad, BAND, 99n, 2, MAX_BIDS)).toThrow(/!= pro-rata/);
  });

  it('B3 pro-rata belt rejects an unfilled above-clearing bid', () => {
    // bid1 @150 (> P) must be full (100); tamper to 99 and compensate on an atP bidder so Σ stays 250.
    const r = computeClearing([bid(1, 150n, 100n, 1), bid(2, 100n, 300n, 2), bid(3, 100n, 300n, 3)], 250n);
    const bad = {
      ...r,
      winners: r.winners.map((w) => {
        if (w.chainBidId === 1) return { ...w, allocatedCount: '99' };
        if (w.chainBidId === 2) return { ...w, allocatedCount: '76' };
        return w;
      }),
    };
    expect(() => assertClearingInvariants(bad, BAND, 250n, 3, MAX_BIDS)).toThrow(/not fully filled/);
  });

  it('B4 pro-rata belt accepts a zero-alloc excluded bidder priced exactly P', () => {
    const r = computeClearing([bid(1, 100n, 3n, 1), bid(2, 100n, 3n, 2), bid(3, 100n, 1n, 3)], 4n);
    expect(() => assertClearingInvariants(r, BAND, 4n, 3, MAX_BIDS)).not.toThrow();
  });

  it('B5 pro-rata belt guards a corrupt snapshot with no bid at the clearing price', () => {
    const r = good(); // P=100
    const bad = { ...r, bidsSnapshot: r.bidsSnapshot.filter((b) => BigInt(b.priceStroops) !== 100n) };
    expect(() => assertClearingInvariants(bad, BAND, 1000n, 3, MAX_BIDS)).toThrow(/no bid at the clearing price/);
  });
});
