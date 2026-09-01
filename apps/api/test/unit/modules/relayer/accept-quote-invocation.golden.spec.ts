import { describe, it, expect } from 'vitest';
import { xdr, Address, nativeToScVal, StrKey } from '@stellar/stellar-sdk';
import {
  encodeAcceptQuoteArgs,
  encodeAuthTupleArgs,
  computeUsdcSplit,
  buildSellerRootInvocation,
  buildBuyerRootInvocation,
  type AcceptQuoteArgs,
} from '../../../../src/modules/relayer/accept-quote-invocation';

/**
 * Golden-vector pin for the `MarketplaceSettler.accept_quote` ABI + its `require_auth_for_args` auth tree
 * (TOV-177). Locks: the 7-arg operation order/types, the 5-tuple authorized-root (buyer/seller addresses
 * EXCLUDED), the seller root-only tree, the buyer root + 3 usdc-transfer subtree, and the 1.5%/1.5% split.
 * A reorder, a u128-vs-i128 drift, or a wrong tree shape is then a red test, not a live-testnet host-reject.
 */
const contractId = (n: number) => StrKey.encodeContract(Buffer.concat([Buffer.alloc(31, 0), Buffer.from([n])]));

const SETTLER = contractId(1);
const USDC = contractId(2);
const BUYER = contractId(3);
const SELLER = contractId(4);
const TREASURY = contractId(5);
const ARTIST = contractId(6);
const args: AcceptQuoteArgs = {
  rfqId: new Uint8Array(32).fill(0x11),
  quoteId: new Uint8Array(32).fill(0x22),
  artworkId: new Uint8Array(32).fill(0x33),
  buyer: BUYER,
  seller: SELLER,
  count: 500n,
  gross: 10_000n,
};

describe('encodeAcceptQuoteArgs (golden — the 7-arg operation)', () => {
  const a = encodeAcceptQuoteArgs(args);
  it('emits exactly 7 positional args in ABI order', () => {
    expect(a).toHaveLength(7);
  });
  it('args[0..2] are the 3 BytesN<32> ids', () => {
    expect(a[0].toXDR('base64')).toBe(xdr.ScVal.scvBytes(Buffer.alloc(32, 0x11)).toXDR('base64'));
    expect(a[1].toXDR('base64')).toBe(xdr.ScVal.scvBytes(Buffer.alloc(32, 0x22)).toXDR('base64'));
    expect(a[2].bytes()).toHaveLength(32);
  });
  it('args[3..4] are buyer + seller Addresses', () => {
    expect(a[3].toXDR('base64')).toBe(Address.fromString(BUYER).toScVal().toXDR('base64'));
    expect(a[4].toXDR('base64')).toBe(Address.fromString(SELLER).toScVal().toXDR('base64'));
  });
  it('args[5..6] are count + gross as i128', () => {
    expect(a[5].switch()).toBe(xdr.ScValType.scvI128());
    expect(a[6].switch()).toBe(xdr.ScValType.scvI128());
    expect(a[6].toXDR('base64')).toBe(nativeToScVal(10_000n, { type: 'i128' }).toXDR('base64'));
  });
});

describe('encodeAuthTupleArgs (golden — the require_auth_for_args 5-tuple)', () => {
  const t = encodeAuthTupleArgs(args);
  it('emits exactly 5 args, EXCLUDING the buyer/seller addresses', () => {
    expect(t).toHaveLength(5);
    // No arg equals the buyer/seller Address ScVal.
    const buyerScv = Address.fromString(BUYER).toScVal().toXDR('base64');
    const sellerScv = Address.fromString(SELLER).toScVal().toXDR('base64');
    expect(t.map((x) => x.toXDR('base64'))).not.toContain(buyerScv);
    expect(t.map((x) => x.toXDR('base64'))).not.toContain(sellerScv);
  });
  it('is (rfq_id, quote_id, artwork_id, count, gross)', () => {
    expect(t[0].bytes()).toHaveLength(32);
    expect(t[3].toXDR('base64')).toBe(nativeToScVal(500n, { type: 'i128' }).toXDR('base64'));
    expect(t[4].toXDR('base64')).toBe(nativeToScVal(10_000n, { type: 'i128' }).toXDR('base64'));
  });
});

describe('computeUsdcSplit (1.5% + 1.5%, remainder to seller)', () => {
  it('splits gross 10000 → 150 / 150 / 9700', () => {
    expect(computeUsdcSplit(10_000n)).toEqual({ platformCut: 150n, artistCut: 150n, sellerNet: 9700n });
  });
  it('rounding remainder goes to the seller', () => {
    // gross 101: 101*150/10000 = 1 (floor) each; seller = 101 - 1 - 1 = 99.
    expect(computeUsdcSplit(101n)).toEqual({ platformCut: 1n, artistCut: 1n, sellerNet: 99n });
  });
});

describe('auth tree shapes (golden)', () => {
  it('seller root is accept_quote(5-tuple) with NO sub-invocations', () => {
    const seller = buildSellerRootInvocation(SETTLER, args);
    const fn = seller.function().contractFn();
    expect(fn.functionName().toString()).toBe('accept_quote');
    expect(Address.fromScAddress(fn.contractAddress()).toString()).toBe(SETTLER);
    expect(fn.args()).toHaveLength(5); // require_auth_for_args tuple
    expect(seller.subInvocations()).toHaveLength(0);
  });

  it('buyer root is accept_quote(5-tuple) + 3 usdc.transfer subs from=buyer (treasury/artist/seller)', () => {
    const buyer = buildBuyerRootInvocation({ settlerContract: SETTLER, usdcContract: USDC, treasury: TREASURY, artistPayout: ARTIST, args });
    expect(buyer.function().contractFn().args()).toHaveLength(5);
    const subs = buyer.subInvocations();
    expect(subs).toHaveLength(3);
    const legs = subs.map((s) => {
      const fn = s.function().contractFn();
      return {
        contract: Address.fromScAddress(fn.contractAddress()).toString(),
        name: fn.functionName().toString(),
        from: Address.fromScAddress(fn.args()[0].address()).toString(),
        to: Address.fromScAddress(fn.args()[1].address()).toString(),
      };
    });
    expect(legs.every((l) => l.contract === USDC && l.name === 'transfer' && l.from === BUYER)).toBe(true);
    expect(legs.map((l) => l.to)).toEqual([TREASURY, ARTIST, SELLER]);
  });

  it('a zero cut omits its leg (e.g. gross too small for a 1.5% cut)', () => {
    const small = buildBuyerRootInvocation({
      settlerContract: SETTLER, usdcContract: USDC, treasury: TREASURY, artistPayout: ARTIST,
      args: { ...args, gross: 10n }, // 10*150/10000 = 0 → platform + artist legs skipped
    });
    expect(small.subInvocations()).toHaveLength(1); // only the seller_net leg
  });
});
