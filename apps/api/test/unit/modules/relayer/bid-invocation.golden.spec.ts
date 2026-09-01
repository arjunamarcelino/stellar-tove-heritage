import { describe, it, expect } from 'vitest';
import { xdr, Address, nativeToScVal, StrKey } from '@stellar/stellar-sdk';
import { encodeSubmitBidArgs } from '../../../../src/modules/relayer/bid-invocation';

/**
 * Golden-vector pin for the `submit_bid` positional ABI encoding (TOV-156). Three same-shaped mistakes a
 * reorder could hide — so assert each arg's canonical XDR index-by-index. A swap of price/count, an
 * address vs bytes mix-up, or a u128-vs-i128 drift is then a red test, not a live-testnet host-reject.
 * ABI: submit_bid(bidder: Address, price: i128, count: i128, idempotency_key: BytesN<32>).
 */
const contractId = (n: number) =>
  StrKey.encodeContract(Buffer.concat([Buffer.alloc(31, 0), Buffer.from([n])]));

describe('encodeSubmitBidArgs (golden)', () => {
  const bidder = contractId(9);
  const idem = Buffer.alloc(32, 7);
  const args = encodeSubmitBidArgs({ bidder, price: 100000000n, count: 10n, idempotencyKey: idem });

  it('emits exactly 4 positional args in ABI order', () => {
    expect(args).toHaveLength(4);
  });

  it('args[0] is the bidder Address', () => {
    expect(args[0].toXDR('base64')).toBe(Address.fromString(bidder).toScVal().toXDR('base64'));
  });

  it('args[1] is the price as i128 (not u128/u64)', () => {
    expect(args[1].switch()).toBe(xdr.ScValType.scvI128());
    expect(args[1].toXDR('base64')).toBe(nativeToScVal(100000000n, { type: 'i128' }).toXDR('base64'));
  });

  it('args[2] is the count as i128', () => {
    expect(args[2].switch()).toBe(xdr.ScValType.scvI128());
    expect(args[2].toXDR('base64')).toBe(nativeToScVal(10n, { type: 'i128' }).toXDR('base64'));
  });

  it('args[3] is the 32-byte idempotency key as bytes', () => {
    expect(args[3].switch()).toBe(xdr.ScValType.scvBytes());
    expect(args[3].bytes()).toHaveLength(32);
    expect(args[3].toXDR('base64')).toBe(xdr.ScVal.scvBytes(idem).toXDR('base64'));
  });
});
