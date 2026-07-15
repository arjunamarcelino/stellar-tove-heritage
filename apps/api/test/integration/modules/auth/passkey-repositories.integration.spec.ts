import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { User } from '@modules/users/entities/user.entity';
import { Wallet } from '@modules/wallets/entities/wallet.entity';
import { PasskeyCredential } from '@modules/wallets/entities/passkey-credential.entity';
import { PasskeyChallenge } from '@modules/auth/entities/passkey-challenge.entity';
import { PasskeyChallengeRepository } from '@modules/auth/repositories/passkey-challenge.repository';
import {
  PASSKEY_CHALLENGE_REPOSITORY,
  IPasskeyChallengeRepository,
} from '@modules/auth/repositories/passkey-challenge-repository.interface';
import { PasskeyCredentialRepository } from '@modules/wallets/repositories/passkey-credential.repository';
import {
  PASSKEY_CREDENTIAL_REPOSITORY,
  IPasskeyCredentialRepository,
} from '@modules/wallets/repositories/passkey-credential-repository.interface';
import { createTestingModule, truncateTables } from '../../setup';

@Module({
  imports: [TypeOrmModule.forFeature([PasskeyChallenge, PasskeyCredential, Wallet, User])],
  providers: [
    { provide: PASSKEY_CHALLENGE_REPOSITORY, useClass: PasskeyChallengeRepository },
    { provide: PASSKEY_CREDENTIAL_REPOSITORY, useClass: PasskeyCredentialRepository },
  ],
})
class PasskeyRepoTestModule {}

const future = () => new Date(Date.now() + 5 * 60_000);
const past = () => new Date(Date.now() - 60_000);

describe('Passkey repositories (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let challenges: IPasskeyChallengeRepository;
  let credentials: IPasskeyCredentialRepository;

  beforeAll(async () => {
    moduleRef = await createTestingModule(PasskeyRepoTestModule);
    dataSource = moduleRef.get(DataSource);
    challenges = moduleRef.get(PASSKEY_CHALLENGE_REPOSITORY);
    credentials = moduleRef.get(PASSKEY_CREDENTIAL_REPOSITORY);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
  });

  // --- challenge repo ---------------------------------------------------------

  it('creates and finds a challenge by its value', async () => {
    await challenges.create({ email: 'a@example.com', challenge: 'chal-1', expiresAt: future() });
    const found = await challenges.findByChallenge('chal-1');
    expect(found?.email).toBe('a@example.com');
    expect(found?.consumedAt).toBeNull();
  });

  it('consumeByChallenge is single-use (compare-and-set)', async () => {
    await challenges.create({ email: 'a@example.com', challenge: 'chal-2', expiresAt: future() });
    expect(await challenges.consumeByChallenge('chal-2')).toBe(true);
    expect(await challenges.consumeByChallenge('chal-2')).toBe(false);
  });

  it('consumeByChallenge inside a transaction participates in rollback', async () => {
    await challenges.create({ email: 'a@example.com', challenge: 'chal-3', expiresAt: future() });
    await expect(
      dataSource.transaction(async (manager) => {
        const ok = await challenges.consumeByChallenge('chal-3', manager);
        expect(ok).toBe(true);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    // rolled back -> still consumable
    expect(await challenges.consumeByChallenge('chal-3')).toBe(true);
  });

  it('pruneOutstandingByEmail keeps the N newest outstanding challenges', async () => {
    for (let i = 0; i < 5; i++) {
      await challenges.create({ email: 'p@example.com', challenge: `p-${i}`, expiresAt: future() });
    }
    await challenges.pruneOutstandingByEmail('p@example.com', 2);
    const remaining = await Promise.all(
      Array.from({ length: 5 }, (_, i) => challenges.findByChallenge(`p-${i}`)),
    );
    expect(remaining.filter(Boolean)).toHaveLength(2);
    // newest kept (p-3, p-4)
    expect(await challenges.findByChallenge('p-4')).not.toBeNull();
    expect(await challenges.findByChallenge('p-0')).toBeNull();
  });

  it('deleteExpired removes only past-expiry rows', async () => {
    await challenges.create({ email: 'e@example.com', challenge: 'live', expiresAt: future() });
    await challenges.create({ email: 'e@example.com', challenge: 'dead', expiresAt: past() });
    await challenges.deleteExpired();
    expect(await challenges.findByChallenge('live')).not.toBeNull();
    expect(await challenges.findByChallenge('dead')).toBeNull();
  });

  // --- credential repo + wallet aggregate ------------------------------------

  async function seedPasskeyWallet(email: string, credentialId: string): Promise<Wallet> {
    const user = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({ email, passwordHash: null, isActive: true }),
    );
    const wallet = await dataSource.getRepository(Wallet).save(
      dataSource.getRepository(Wallet).create({
        userId: user.id,
        publicKey: null,
        contractAddress: `C${'A'.repeat(54)}${credentialId.length % 10}`.slice(0, 56),
        kind: 'embedded_passkey',
      }),
    );
    await dataSource.getRepository(PasskeyCredential).save(
      dataSource.getRepository(PasskeyCredential).create({
        walletId: wallet.id,
        credentialId,
        publicKey: Buffer.from([0x04, 0xaa, 0xbb]),
        counter: 0,
      }),
    );
    return wallet;
  }

  it('findByCredentialId returns the credential with wallet+user, misses when absent', async () => {
    await seedPasskeyWallet('c1@example.com', 'cred-1');
    const found = await credentials.findByCredentialId('cred-1');
    expect(found?.wallet.user.email).toBe('c1@example.com');
    expect(found?.counter).toBe(0);
    expect(typeof found?.counter).toBe('number');
    expect(await credentials.findByCredentialId('nope')).toBeNull();
  });

  it('counter round-trips a non-zero value as a number (bigint transformer)', async () => {
    const wallet = await seedPasskeyWallet('c2@example.com', 'cred-2');
    const repo = dataSource.getRepository(PasskeyCredential);
    const cred = await repo.findOneOrFail({ where: { walletId: wallet.id } });
    cred.counter = 42;
    await repo.save(cred);
    const reread = await repo.findOneOrFail({ where: { walletId: wallet.id } });
    expect(reread.counter).toBe(42);
    expect(typeof reread.counter).toBe('number');
  });

  // --- DB CHECK constraints ---------------------------------------------------

  it('rejects an embedded_passkey wallet with a null contract_address', async () => {
    const user = await dataSource.getRepository(User).save({ email: 'x1@example.com', isActive: true });
    await expect(
      dataSource.query(
        `INSERT INTO wallets (user_id, kind, contract_address, public_key) VALUES ($1,'embedded_passkey',NULL,NULL)`,
        [user.id],
      ),
    ).rejects.toThrow(/CHK_wallets_kind_fields/);
  });

  it('rejects an embedded_passkey wallet that carries a public_key', async () => {
    const user = await dataSource.getRepository(User).save({ email: 'x2@example.com', isActive: true });
    await expect(
      dataSource.query(
        `INSERT INTO wallets (user_id, kind, contract_address, public_key) VALUES ($1,'embedded_passkey',$2,$3)`,
        [user.id, `C${'A'.repeat(55)}`, `G${'A'.repeat(55)}`],
      ),
    ).rejects.toThrow(/CHK_wallets_kind_fields/);
  });

  it('rejects a byow wallet that carries a contract_address', async () => {
    const user = await dataSource.getRepository(User).save({ email: 'x3@example.com', isActive: true });
    await expect(
      dataSource.query(
        `INSERT INTO wallets (user_id, kind, contract_address, public_key) VALUES ($1,'byow',$2,$3)`,
        [user.id, `C${'A'.repeat(55)}`, `G${'A'.repeat(55)}`],
      ),
    ).rejects.toThrow(/CHK_wallets_kind_fields/);
  });

  it('rejects a user with a password_hash but no email', async () => {
    await expect(
      dataSource.query(`INSERT INTO users (password_hash, is_active) VALUES ($1, true)`, [
        '$2b$12$abcdefghijklmnopqrstuv',
      ]),
    ).rejects.toThrow(/CHK_users_password_needs_email/);
  });

  it('allows a passkey user (email set, password_hash null)', async () => {
    await expect(
      dataSource.query(`INSERT INTO users (email, is_active) VALUES ($1, true)`, ['ok@example.com']),
    ).resolves.toBeDefined();
  });
});
