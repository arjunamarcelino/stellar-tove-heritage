export const RELAYER_ACCOUNT_LOCK = 'IRelayerAccountLock';

/**
 * A mutual-exclusion lock that serializes EVERY sequence-consuming submission on the shared relayer
 * account (one keypair = one sequence number) — both wallet deploys (TOV-21) and passkey-signed
 * transfers (TOV-22). Deploy and submit MUST contend on the same key, so a concurrent deploy + submit
 * can't build the same sequence and collide with txBAD_SEQ. The Redis-backed impl serializes ACROSS
 * instances; the in-memory impl serializes within a single process (tests / single-instance fallback).
 */
export interface IRelayerAccountLock {
  /** Run `fn` while holding `key`. `ttlMs` is a crash-safety ceiling on the hold. */
  withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T>;
}
