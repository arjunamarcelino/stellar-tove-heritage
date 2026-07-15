import { EntityManager } from 'typeorm';
import { AuthChallenge } from '../entities/auth-challenge.entity';

export const AUTH_CHALLENGE_REPOSITORY = 'IAuthChallengeRepository';

export interface CreateAuthChallengeInput {
  publicKey: string;
  txHash: string;
  expiresAt: Date;
  /** Owner of a wallet-BIND challenge (TOV-24); NULL for an anonymous LOGIN challenge. */
  userId?: string | null;
}

export interface IAuthChallengeRepository {
  create(input: CreateAuthChallengeInput): Promise<AuthChallenge>;
  findByTxHash(txHash: string): Promise<AuthChallenge | null>;
  /**
   * Atomically flip pending -> consumed. Returns true iff THIS call consumed it. Accepts an optional
   * `EntityManager` so the wallet-bind flow can consume inside its write transaction (a rolled-back bind
   * leaves the challenge live/retryable).
   */
  consumeByTxHash(txHash: string, manager?: EntityManager): Promise<boolean>;
  /**
   * Evict the oldest outstanding (unconsumed, unexpired) challenges for a public
   * key, keeping at most `keep` newest. Bounds per-key growth WITHOUT a hard cap
   * (a hard cap lets a third party lock a victim out by spamming challenges).
   */
  pruneOutstanding(publicKey: string, keep: number): Promise<void>;
  deleteExpired(): Promise<void>;
}
