import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PasskeyChallenge } from '../entities/passkey-challenge.entity';
import {
  CreatePasskeyChallengeInput,
  IPasskeyChallengeRepository,
} from './passkey-challenge-repository.interface';

/**
 * Ephemeral WebAuthn challenge store. Like `AuthChallengeRepository`, it does NOT
 * extend `BaseRepository` (no soft-delete/pagination); every operation is
 * specialized -- atomic compare-and-set consume, prune-oldest, bounded sweep.
 */
@Injectable()
export class PasskeyChallengeRepository implements IPasskeyChallengeRepository {
  constructor(
    @InjectRepository(PasskeyChallenge)
    private readonly repo: Repository<PasskeyChallenge>,
  ) {}

  async create(input: CreatePasskeyChallengeInput): Promise<PasskeyChallenge> {
    return this.repo.save(this.repo.create(input));
  }

  async findByChallenge(challenge: string): Promise<PasskeyChallenge | null> {
    return this.repo.findOne({ where: { challenge } });
  }

  async consumeByChallenge(challenge: string, manager?: EntityManager): Promise<boolean> {
    // Single-statement compare-and-set: only the still-pending row flips, so exactly
    // one concurrent finish wins. Runs on the caller's EntityManager when supplied
    // (participates in the finish transaction; a rolled-back bind leaves it live).
    const repo = manager ? manager.getRepository(PasskeyChallenge) : this.repo;
    const result = await repo
      .createQueryBuilder()
      .update(PasskeyChallenge)
      .set({ consumedAt: () => 'now()' })
      .where('challenge = :challenge AND consumed_at IS NULL', { challenge })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async pruneOutstandingByEmail(email: string, keep: number): Promise<void> {
    // Keep the `keep` newest outstanding challenges for the email; delete the rest.
    await this.repo.query(
      `DELETE FROM passkey_challenges
       WHERE id IN (
         SELECT id FROM passkey_challenges
         WHERE email = $1 AND consumed_at IS NULL AND expires_at > now()
         ORDER BY created_at DESC
         OFFSET $2
       )`,
      [email, keep],
    );
  }

  async deleteExpired(): Promise<void> {
    // Single-runner (advisory lock) + bounded (LIMIT). A distinct lock constant from
    // SEP-10's (4020111) so the two sweeps don't needlessly serialize.
    await this.repo.query(`
      WITH claimed AS (SELECT pg_try_advisory_xact_lock(4020112) AS ok)
      DELETE FROM passkey_challenges
      WHERE (SELECT ok FROM claimed)
        AND ctid IN (
          SELECT ctid FROM passkey_challenges WHERE expires_at < now() LIMIT 500
        )
    `);
  }
}
