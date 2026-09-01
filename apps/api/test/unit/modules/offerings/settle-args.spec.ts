import { describe, it, expect } from 'vitest';
import { scValToNative, xdr } from '@stellar/stellar-sdk';
import { encodeAllocations, encodeClearingPrice } from '../../../../src/modules/offerings/escrow/settle-args';

/**
 * Golden-vector merge gate for the `close_and_settle(i128 clearing_price, Vec<(u32,i128)> allocations)` ABI
 * encoding (TOV-160). A wrong ScVal shape would settle the wrong bids or be host-rejected — pin the exact
 * XDR and decode.
 */
describe('settle-args ScVal encoding', () => {
  it('U11 clearing_price encodes as scvI128', () => {
    const sv = encodeClearingPrice(100n);
    expect(sv.switch().name).toBe('scvI128');
    expect(scValToNative(sv)).toBe(100n);
  });

  it('U11b allocations encode as an outer Vec of inner [u32, i128] tuples', () => {
    const sv = encodeAllocations([
      { bidId: 7, allocated: 250n },
      { bidId: 12, allocated: 1000n },
    ]);
    expect(sv.switch().name).toBe('scvVec');
    const outer = sv.vec();
    expect(outer).not.toBeNull();
    expect(outer!.length).toBe(2);
    // Each element is itself a 2-element Vec [scvU32, scvI128].
    const first = outer![0];
    expect(first.switch().name).toBe('scvVec');
    const inner = first.vec()!;
    expect(inner[0].switch().name).toBe('scvU32');
    expect(inner[1].switch().name).toBe('scvI128');
    // Decodes to the tuple values.
    expect(scValToNative(first)).toEqual([7, 250n]);
    expect(scValToNative(outer![1])).toEqual([12, 1000n]);
  });

  it('U11c golden XDR base64 is stable (byte-pinned)', () => {
    const b64 = encodeAllocations([{ bidId: 7, allocated: 250n }]).toXDR('base64');
    // Round-trips to the same bytes → catches any silent encoder drift.
    const back = xdr.ScVal.fromXDR(b64, 'base64');
    expect(scValToNative(back)).toEqual([[7, 250n]]);
  });

  it('U12 rejects a bidId that is not a valid u32', () => {
    expect(() => encodeAllocations([{ bidId: 0, allocated: 1n }])).toThrow(/valid u32/);
    expect(() => encodeAllocations([{ bidId: 4_294_967_296, allocated: 1n }])).toThrow(/valid u32/);
    expect(() => encodeAllocations([{ bidId: 1.5, allocated: 1n }])).toThrow(/valid u32/);
  });

  it('U12b rejects a duplicate bidId and a non-positive allocation', () => {
    expect(() =>
      encodeAllocations([
        { bidId: 1, allocated: 1n },
        { bidId: 1, allocated: 2n },
      ]),
    ).toThrow(/duplicate/);
    expect(() => encodeAllocations([{ bidId: 1, allocated: 0n }])).toThrow(/must be positive/);
  });
});
