import { xdr, Address, Contract, nativeToScVal, Operation } from '@stellar/stellar-sdk';

/**
 * The ONE place the `OfferingEscrow.submit_bid` positional ABI order lives (TOV-156), mirroring
 * `offering-escrow-args.ts` for the deploy path. `submit_bid(bidder, price, count, idempotency_key)` —
 * a golden-vector unit test pins this encoding so an accidental reorder/type-drift is a red test, not a
 * host-reject discovered only on live testnet. Amounts are `bigint` at this boundary (a bare bigint
 * would infer u64/u128 — the host rejects it — so the explicit `{ type: 'i128' }` hint is load-bearing).
 */
export interface SubmitBidArgs {
  bidder: string; // the bidder smart-wallet (C-address)
  price: bigint; // i128 stroops per fraction
  count: bigint; // i128 fraction count
  idempotencyKey: Uint8Array; // BytesN<32>
}

export function encodeSubmitBidArgs(a: SubmitBidArgs): xdr.ScVal[] {
  return [
    Address.fromString(a.bidder).toScVal(),
    nativeToScVal(a.price, { type: 'i128' }),
    nativeToScVal(a.count, { type: 'i128' }),
    xdr.ScVal.scvBytes(Buffer.from(a.idempotencyKey)),
  ];
}

/** The `submit_bid` invoke operation on the offering's escrow contract (unsigned auth attached later). */
export function buildSubmitBidOperation(
  escrowContract: string,
  args: SubmitBidArgs,
): xdr.Operation<Operation.InvokeHostFunction> {
  return new Contract(escrowContract).call('submit_bid', ...encodeSubmitBidArgs(args));
}

/**
 * The nested `SorobanAuthorizedInvocation` a real `submit_bid` produces: root `submit_bid` with the inner
 * `usdc.transfer(bidder → escrow, price*count)` as a sub-invocation (empirically confirmed against the
 * contract's test snapshots). The real adapter takes this tree from `simulateTransaction`; the in-memory
 * fake builds it here so the verifier can be exercised end-to-end offline. The bidder's single passkey
 * signature over the root covers the inner transfer (the SAC `from.require_auth` is a sub-node).
 */
export function buildSubmitBidRootInvocation(params: {
  escrowContract: string;
  tokenContract: string;
  bidder: string;
  price: bigint;
  count: bigint;
  idempotencyKey: Uint8Array;
}): xdr.SorobanAuthorizedInvocation {
  const escrowAmount = params.price * params.count;
  const rootFn = new Contract(params.escrowContract)
    .call(
      'submit_bid',
      ...encodeSubmitBidArgs({
        bidder: params.bidder,
        price: params.price,
        count: params.count,
        idempotencyKey: params.idempotencyKey,
      }),
    )
    .body()
    .invokeHostFunctionOp()
    .hostFunction()
    .invokeContract();

  const innerTransferFn = new Contract(params.tokenContract)
    .call(
      'transfer',
      Address.fromString(params.bidder).toScVal(),
      Address.fromString(params.escrowContract).toScVal(),
      nativeToScVal(escrowAmount, { type: 'i128' }),
    )
    .body()
    .invokeHostFunctionOp()
    .hostFunction()
    .invokeContract();

  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(rootFn),
    subInvocations: [
      new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(innerTransferFn),
        subInvocations: [],
      }),
    ],
  });
}
