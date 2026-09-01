/**
 * Redis lock key for the KYC allowlist admin account (TOV-235). The admin key is also the tx source, so it
 * has its OWN sequence — a distinct lock key from `relayer:fraction:account` / the passkey
 * `RELAYER_ACCOUNT_LOCK` means allowlist batches never collide with those on-chain ops. Held per-item across
 * getAccount→build→simulate→send→poll-to-closure, so the next item's getAccount sees the advanced sequence.
 */
export const KYC_ALLOWLIST_RELAYER_LOCK_KEY = 'relayer:kyc-allowlist:account';

/**
 * Buffer added to `submitTimeoutMs` to derive the per-item lock TTL. The lock is held across the WHOLE
 * critical section including poll-to-closure, so the TTL must exceed `submitTimeoutMs` (the poll bound)
 * plus the non-poll RPCs (getAccount + simulate + send + a trailing getTransaction, each ≤ RPC_TIMEOUT_MS).
 * Derived from `submitTimeoutMs` at call time so the two can't drift and the TTL can never expire mid-item
 * (which would reopen the concurrent-batch txBadSeq race the lock exists to prevent — see todo 227).
 */
export const LOCK_TTL_BUFFER_MS = 25_000;

/** Confirmation poll cadence (ms). Ledger close is ~5-6s, so polling faster only multiplies RPC calls. */
export const POLL_INTERVAL_MS = 2_000;

/** Bounded RPC timeout for a single Soroban call (getAccount / simulate / send / getTransaction). */
export const RPC_TIMEOUT_MS = 5_000;

/** Cap on concurrent read-only `is_allowed` simulations, so a batch never bursts the public RPC (429s). */
export const RPC_CONCURRENCY = 8;
