/**
 * Typed escrow-deploy errors (TOV-154, Enhancement #13). The base carries a `retryable` flag so the
 * deploy worker (WS7) branches with a single exhaustive check —
 * `if (err instanceof OfferingEscrowError && err.retryable) throw err` (transient → BullMQ retry),
 * else latch `failed`. `new.target.name` gives each subclass its own `name` without per-class boilerplate.
 */
export class OfferingEscrowError extends Error {
  constructor(
    msg: string,
    readonly retryable: boolean,
  ) {
    super(msg);
    this.name = new.target.name;
  }
}

/** RPC throttled the submit (`TRY_AGAIN_LATER`) — transient, retry the whole deploy. */
export class OfferingEscrowThrottledError extends OfferingEscrowError {
  constructor(msg = 'offering escrow deploy throttled') {
    super(msg, true);
  }
}

/** `txBadSeq` on the shared escrow source account — transient, re-fetch sequence + retry. */
export class OfferingEscrowSequenceError extends OfferingEscrowError {
  constructor(msg = 'txBadSeq on the offering escrow account') {
    super(msg, true);
  }
}

/**
 * A constructor param drifted between quorum and deploy (money-routing attestation / public_float
 * belt) — terminal: never adopt, never retry, latch `failed`.
 */
export class EscrowParamDriftError extends OfferingEscrowError {
  constructor(msg = 'offering escrow constructor params drifted since approval') {
    super(msg, false);
  }
}

/**
 * A contract already exists at the derived address but its WASM hash != the configured escrow hash
 * (security HIGH-3) — terminal: refuse to adopt an unknown/hostile contract, latch `failed`.
 */
export class OfferingEscrowWasmMismatchError extends OfferingEscrowError {
  constructor(msg = 'on-chain contract at derived escrow address has an unexpected WASM hash') {
    super(msg, false);
  }
}

/**
 * `close_and_settle` reverted at SIMULATION with a deterministic failure (TOV-160) — a typed contract error
 * (`InvalidAllocation=8`, `TokenNotBound=13`, `NotClosed=7`, `AlreadySettled=10`, …) OR a tx-level resource
 * exhaustion (`ExceededLimit`, `TxTooLarge`, budget). ALL terminal: the same allocations/book will fail
 * again, so re-driving would loop forever. `contractCode` is the parsed `#<n>` when the revert is a contract
 * error (`null` for a resource/host failure). The worker stamps `OFFERING_SETTLE_FAILED` + throws
 * `UnrecoverableError`, leaving the offering `subscribed` (never partially settled — the tx is atomic).
 */
export class OfferingSettleContractError extends OfferingEscrowError {
  constructor(
    msg: string,
    readonly contractCode: number | null,
  ) {
    super(msg, false);
  }
}
