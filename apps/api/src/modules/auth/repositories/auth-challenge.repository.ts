import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuthChallenge } from '../entities/auth-challenge.entity';
import {
  CreateAuthChallengeInput,
  IAuthChallengeRepository,
} from './auth-challenge-repository.interface';

/**
 * Deliberately does NOT extend `BaseRepository`: `AuthChallenge` is ephemeral
 * (no soft-delete, no pagination) and every operation is specialized — atomic
 * compare-and-set consume, prune-oldest, bounded sweep. It still honors the
 * project's repo convention via a dedicated interface + DI token
 * (`AUTH_CHALLENGE_REPOSITORY` / `IAuthChallengeRepository`).
 */
@Injectable()
export class AuthChallengeRepository implements IAuthChallengeRepository {
  constructor(
    @InjectRepository(AuthChallenge)
    private readonly repo: Repository<AuthChallenge>,
  ) {}

  async create(input: CreateAuthChallengeInput): Promise<AuthChallenge> {
    return this.repo.save(this.repo.create(input));
  }

  async findByTxHash(txHash: string): Promise<AuthChallenge | null> {
    return this.repo.findOne({ where: { txHash } });
  }

  async consumeByTxHash(txHash: string, manager?: EntityManager): Promise<boolean> {
    // Single-statement compare-and-set: only the row still pending flips, so
    // exactly one concurrent verify wins. Runs on the caller's manager when the
    // wallet-bind flow consumes inside its write transaction.
    const repo = manager ? manager.getRepository(AuthChallenge) : this.repo;
    const result = await repo
      .createQueryBuilder()
      .update(AuthChallenge)
      .set({ consumedAt: () => 'now()' })
      .where('tx_hash = :txHash AND consumed_at IS NULL', { txHash })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async pruneOutstanding(publicKey: string, keep: number): Promise<void> {
    // Keep the `keep` newest outstanding challenges; delete the rest (oldest).
    await this.repo.query(
      `DELETE FROM auth_challenges
       WHERE id IN (
         SELECT id FROM auth_challenges
         WHERE public_key = $1 AND consumed_at IS NULL AND expires_at > now()
         ORDER BY created_at DESC
         OFFSET $2
       )`,
      [publicKey, keep],
    );
  }

  async deleteExpired(): Promise<void> {
    // Single-runner (advisory lock) + bounded (LIMIT) so concurrent verifies /
    // challenges don't stack long, unbounded full-table DELETEs. If another sweep
    // holds the lock, this call no-ops. A dedicated scheduled sweep for large
    // backlogs remains a follow-up (see todo 091).
    await this.repo.query(`
      WITH claimed AS (SELECT pg_try_advisory_xact_lock(4020111) AS ok)
      DELETE FROM auth_challenges
      WHERE (SELECT ok FROM claimed)
        AND ctid IN (
          SELECT ctid FROM auth_challenges WHERE expires_at < now() LIMIT 500
        )
    `);
  }
}
