import { xdr, Address, Contract, nativeToScVal, Operation } from '@stellar/stellar-sdk';

/**
 * The ONE place the `MarketplaceSettler.accept_quote` positional ABI + its `require_auth_for_args` auth tree
 * live (TOV-177), mirroring `bid-invocation.ts`. The deployed contract:
 *
 *   accept_quote(rfq_id: BytesN<32>, quote_id: BytesN<32>, artwork_id: BytesN<32>,
 *                buyer: Address, seller: Address, count: i128, gross_usdc: i128)
 *
 * calls `buyer.require_auth_for_args(TUPLE)` AND `seller.require_auth_for_args(TUPLE)` where
 * **TUPLE = (rfq_id, quote_id, artwork_id, count, gross_usdc)** — five elements, the two Address args
 * EXCLUDED. So each authorized `SorobanAuthorizedInvocation` root carries the 5-tuple, NOT the 7 call args
 * (a critical divergence from the bid flow: the operation's args and the authorized root's args DIFFER).
 * Inside, `FractionToken.settle_trade` runs 3 `usdc.transfer(buyer → {treasury, artist_payout, seller})`
 * legs (1.5% + 1.5% + rest) as sub-invocations of the BUYER's auth tree; the seller's tree is root-only
 * (the fraction leg is auth-less). Golden-vector-pinned so a reorder/type-drift is a red test, not a
 * host-reject discovered only on live testnet.
 *
 * Amounts are `bigint`; the explicit `{ type: 'i128' }` hint is load-bearing (a bare bigint infers u128 →
 * host reject). BytesN<32> ids are `Uint8Array` (the relayer derives them via sha256 of the uuid).
 */

// FractionToken.settle_trade split constants (compile-time in the contract: PLATFORM_FEE_BPS = ROYALTY_BPS = 150).
export const PLATFORM_FEE_BPS = 150n;
export const ROYALTY_BPS = 150n;
export const BPS_DENOM = 10_000n;

/** The USDC split `settle_trade` performs (floor division; the rounding remainder goes to the seller). */
export function computeUsdcSplit(gross: bigint): { platformCut: bigint; artistCut: bigint; sellerNet: bigint } {
  const platformCut = (gross * PLATFORM_FEE_BPS) / BPS_DENOM;
  const artistCut = (gross * ROYALTY_BPS) / BPS_DENOM;
  return { platformCut, artistCut, sellerNet: gross - platformCut - artistCut };
}

export interface AcceptQuoteArgs {
  rfqId: Uint8Array; // BytesN<32>
  quoteId: Uint8Array; // BytesN<32>
  artworkId: Uint8Array; // BytesN<32>
  buyer: string; // buyer smart-wallet (C-address)
  seller: string; // seller smart-wallet (C-address)
  count: bigint; // i128 fraction count
  gross: bigint; // i128 gross USDC (= count × price)
}

function bytes32(v: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.from(v));
}

/** The 7 positional call args of `accept_quote` (the actual operation). */
export function encodeAcceptQuoteArgs(a: AcceptQuoteArgs): xdr.ScVal[] {
  return [
    bytes32(a.rfqId),
    bytes32(a.quoteId),
    bytes32(a.artworkId),
    Address.fromString(a.buyer).toScVal(),
    Address.fromString(a.seller).toScVal(),
    nativeToScVal(a.count, { type: 'i128' }),
    nativeToScVal(a.gross, { type: 'i128' }),
  ];
}

/** The 5-tuple `require_auth_for_args` substitutes into each authorized root (buyer + seller). */
export function encodeAuthTupleArgs(a: AcceptQuoteArgs): xdr.ScVal[] {
  return [
    bytes32(a.rfqId),
    bytes32(a.quoteId),
    bytes32(a.artworkId),
    nativeToScVal(a.count, { type: 'i128' }),
    nativeToScVal(a.gross, { type: 'i128' }),
  ];
}

/** The `accept_quote` invoke operation on the settler (unsigned auth attached later). */
export function buildAcceptQuoteOperation(
  settlerContract: string,
  args: AcceptQuoteArgs,
): xdr.Operation<Operation.InvokeHostFunction> {
  return new Contract(settlerContract).call('accept_quote', ...encodeAcceptQuoteArgs(args));
}

/** The authorized-root `InvokeContractArgs` for `accept_quote` with the 5-tuple (require_auth_for_args). */
function acceptQuoteRootFn(settlerContract: string, args: AcceptQuoteArgs): xdr.InvokeContractArgs {
  return new Contract(settlerContract)
    .call('accept_quote', ...encodeAuthTupleArgs(args))
    .body()
    .invokeHostFunctionOp()
    .hostFunction()
    .invokeContract();
}

function contractFnInvocation(fn: xdr.InvokeContractArgs, subs: xdr.SorobanAuthorizedInvocation[]): xdr.SorobanAuthorizedInvocation {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(fn),
    subInvocations: subs,
  });
}

function usdcTransferSub(usdc: string, from: string, to: string, amount: bigint): xdr.SorobanAuthorizedInvocation {
  const fn = new Contract(usdc)
    .call('transfer', Address.fromString(from).toScVal(), Address.fromString(to).toScVal(), nativeToScVal(amount, { type: 'i128' }))
    .body()
    .invokeHostFunctionOp()
    .hostFunction()
    .invokeContract();
  return contractFnInvocation(fn, []);
}

/**
 * The SELLER's authorized invocation: root `accept_quote`(5-tuple) on the settler, NO sub-invocations (the
 * seller's auth is the sole guard on the auth-less fraction leg). The real adapter takes this from
 * `simulateTransaction`; the fake builds it here so the two-entry verifier can be exercised offline.
 */
export function buildSellerRootInvocation(settlerContract: string, args: AcceptQuoteArgs): xdr.SorobanAuthorizedInvocation {
  return contractFnInvocation(acceptQuoteRootFn(settlerContract, args), []);
}

/**
 * The BUYER's authorized invocation: root `accept_quote`(5-tuple) on the settler + up to 3 `usdc.transfer`
 * sub-invocations (`from = buyer` → treasury/artist_payout/seller, amounts = platform_cut/artist_cut/seller_net).
 * Zero-value legs are omitted (matching the contract's `if cut > 0` skip). One buyer passkey signature over
 * the root covers the whole subtree.
 */
export function buildBuyerRootInvocation(params: {
  settlerContract: string;
  usdcContract: string;
  treasury: string;
  artistPayout: string;
  args: AcceptQuoteArgs;
}): xdr.SorobanAuthorizedInvocation {
  const { platformCut, artistCut, sellerNet } = computeUsdcSplit(params.args.gross);
  const subs: xdr.SorobanAuthorizedInvocation[] = [];
  if (platformCut > 0n) subs.push(usdcTransferSub(params.usdcContract, params.args.buyer, params.treasury, platformCut));
  if (artistCut > 0n) subs.push(usdcTransferSub(params.usdcContract, params.args.buyer, params.artistPayout, artistCut));
  if (sellerNet > 0n) subs.push(usdcTransferSub(params.usdcContract, params.args.buyer, params.args.seller, sellerNet));
  return contractFnInvocation(acceptQuoteRootFn(params.settlerContract, params.args), subs);
}
