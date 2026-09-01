import { EntityManager } from 'typeorm';
import { PasskeyChallenge } from '../entities/passkey-challenge.entity';

export const PASSKEY_CHALLENGE_REPOSITORY = 'IPasskeyChallengeRepository';

export interface CreatePasskeyChallengeInput {
  email: string;
  challenge: string;
  expiresAt: Date;
}

export interface IPasskeyChallengeRepository {
  create(input: CreatePasskeyChallengeInput): Promise<PasskeyChallenge>;
  findByChallenge(challenge: string): Promise<PasskeyChallenge | null>;
  /**
   * Atomically flip pending -> consumed. Returns true iff THIS call consumed it.
   * Accepts an optional `EntityManager` so it can run inside the finish transaction
   * (a rolled-back bind leaves the challenge live/retryable).
   */
  consumeByChallenge(challenge: string, manager?: EntityManager): Promise<boolean>;
  /**
   * Evict the oldest outstanding (unconsumed, unexpired) challenges for an email,
   * keeping at most `keep` newest — bounds per-email growth without a hard cap
   * (a hard cap would let a third party lock an email out by spamming challenges).
   */
  pruneOutstandingByEmail(email: string, keep: number): Promise<void>;
  deleteExpired(): Promise<void>;
}
