import { xdr, Address, Contract, nativeToScVal, Operation } from '@stellar/stellar-sdk';

/**
 * The ONE place the `OfferingEscrow.cancel_bid` positional ABI order lives (TOV-158), mirroring
 * `bid-invocation.ts`. `cancel_bid(caller, bid_id)` — a golden-vector unit test pins this encoding so an
 * accidental reorder/type-drift is a red test, not a host-reject discovered only on live testnet.
 *
 * `bid_id` is a `u32` on-chain (the value `submit_bid` returned + the DB `chain_bid_id`); it is passed as a
 * JS `number` (a u32 < 2^53 so the entity's bigint→Number transformer is lossless). NB: unlike the i128
 * amounts in `submit_bid`, `u32` takes a plain number — no `bigint`.
 */
export interface CancelBidArgs {
  caller: string; // the bidder smart-wallet (C-address) — must equal the recorded bid.collector_wallet
  bidId: number; // u32 on-chain bid id
}

export function encodeCancelBidArgs(a: CancelBidArgs): xdr.ScVal[] {
  return [Address.fromString(a.caller).toScVal(), nativeToScVal(a.bidId, { type: 'u32' })];
}

/** The `cancel_bid` invoke operation on the offering's escrow contract (unsigned auth attached later). */
export function buildCancelBidOperation(
  escrowContract: string,
  args: CancelBidArgs,
): xdr.Operation<Operation.InvokeHostFunction> {
  return new Contract(escrowContract).call('cancel_bid', ...encodeCancelBidArgs(args));
}

/**
 * The `SorobanAuthorizedInvocation` a real `cancel_bid` produces: **root-only, NO sub-invocations**. Unlike
 * `submit_bid` (whose inner `usdc.transfer(bidder → escrow)` needs the bidder's auth as a sub-node), the
 * `cancel_bid` refund is `usdc.transfer(escrow → bidder)` whose `from` is the escrow CONTRACT — authorized by
 * the contract's own credential, NOT part of the caller's signed tree. So the bidder's single passkey
 * signature covers only the root. The real adapter takes this tree from `simulateTransaction`; the in-memory
 * fake builds it here so the verifier can be exercised end-to-end offline.
 */
export function buildCancelBidRootInvocation(params: {
  escrowContract: string;
  caller: string;
  bidId: number;
}): xdr.SorobanAuthorizedInvocation {
  const rootFn = new Contract(params.escrowContract)
    .call('cancel_bid', ...encodeCancelBidArgs({ caller: params.caller, bidId: params.bidId }))
    .body()
    .invokeHostFunctionOp()
    .hostFunction()
    .invokeContract();

  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(rootFn),
    subInvocations: [],
  });
}
