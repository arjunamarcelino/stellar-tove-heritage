import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigType } from '@nestjs/config';
import { Keypair, TransactionBuilder, WebAuth, Networks } from '@stellar/stellar-sdk';
import { Sep10Service } from '../../src/modules/auth/sep10.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { WalletsService } from '../../src/modules/wallets/wallets.service';
import { User } from '../../src/modules/users/entities/user.entity';
import { Wallet } from '../../src/modules/wallets/entities/wallet.entity';
import { sep10Config } from '../../src/config/sep10.config';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { AuthChallenge } from '../../src/modules/auth/entities/auth-challenge.entity';
import {
  CreateAuthChallengeInput,
  IAuthChallengeRepository,
} from '../../src/modules/auth/repositories/auth-challenge-repository.interface';

/** In-memory stand-in for the challenge repo, keyed by tx hash. */
class FakeChallengeRepo implements IAuthChallengeRepository {
  readonly rows = new Map<string, AuthChallenge>();

  private seq = 0;

  create(input: CreateAuthChallengeInput): Promise<AuthChallenge> {
    const row: AuthChallenge = {
      id: `id-${this.rows.size}`,
      publicKey: input.publicKey,
      txHash: input.txHash,
      expiresAt: input.expiresAt,
      consumedAt: null,
      // Monotonic so ordering by createdAt is deterministic in tests.
      createdAt: new Date(2020, 0, 1, 0, 0, 0, this.seq++),
    };
    this.rows.set(input.txHash, row);
    return Promise.resolve(row);
  }
  findByTxHash(txHash: string): Promise<AuthChallenge | null> {
    return Promise.resolve(this.rows.get(txHash) ?? null);
  }
  consumeByTxHash(txHash: string): Promise<boolean> {
    const row = this.rows.get(txHash);
    if (row && !row.consumedAt) {
      row.consumedAt = new Date();
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }
  outstanding(publicKey: string): AuthChallenge[] {
    const now = Date.now();
    return [...this.rows.values()].filter(
      (r) => r.publicKey === publicKey && !r.consumedAt && r.expiresAt.getTime() > now,
    );
  }
  pruneOutstanding(publicKey: string, keep: number): Promise<void> {
    const live = this.outstanding(publicKey).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(), // newest first
    );
    for (const row of live.slice(keep)) this.rows.delete(row.txHash);
    return Promise.resolve();
  }
  deleteExpired(): Promise<void> {
    return Promise.resolve();
  }
}

const NETWORK = Networks.TESTNET;
const serverKeypair = Keypair.random();

const cfg = {
  serverSigningSecret: serverKeypair.secret(),
  homeDomain: 'tove.io',
  webAuthDomain: 'auth.tove.io',
  networkPassphrase: NETWORK,
  challengeTimeout: 300,
  maxOutstandingChallenges: 5,
} as ConfigType<typeof sep10Config>;

function signXdr(xdr: string, kp: Keypair): string {
  const tx = TransactionBuilder.fromXDR(xdr, NETWORK);
  tx.sign(kp);
  return tx.toEnvelope().toXDR('base64');
}

describe('Sep10Service', () => {
  let repo: FakeChallengeRepo;
  let service: Sep10Service;
  // Typed as `Pick<...>` so the mocked method names + signatures are checked
  // against the real services (a shape change breaks the test); the fixture
  // objects are cast since we only need the fields Sep10Service reads.
  const walletsService: Pick<WalletsService, 'findOrCreateForWallet'> = {
    findOrCreateForWallet: (publicKey: string) =>
      Promise.resolve({
        user: { id: 'user-1', email: null } as unknown as User,
        wallet: { publicKey } as unknown as Wallet,
      }),
  };
  const authService: Pick<AuthService, 'issueTokensForUser'> = {
    issueTokensForUser: () =>
      Promise.resolve({ accessToken: 'access.jwt', refreshToken: 'refresh.jwt' }),
  };

  beforeEach(() => {
    repo = new FakeChallengeRepo();
    service = new Sep10Service(
      cfg,
      repo,
      walletsService as unknown as WalletsService,
      authService as unknown as AuthService,
    );
  });

  describe('buildChallenge', () => {
    it('returns a server-signed challenge + passphrase and persists it', async () => {
      const client = Keypair.random();
      const res = await service.buildChallenge(client.publicKey());

      expect(res.networkPassphrase).toBe(NETWORK);
      expect(res.challengeTxXdr).toBeTruthy();
      expect(repo.rows.size).toBe(1);
      // The persisted challenge is a valid SEP-10 tx signed by the server.
      const { clientAccountID } = WebAuth.readChallengeTx(
        res.challengeTxXdr,
        serverKeypair.publicKey(),
        NETWORK,
        'tove.io',
        'auth.tove.io',
      ) as { clientAccountID: string };
      expect(clientAccountID).toBe(client.publicKey());
    });

    it('evicts oldest outstanding challenges instead of rejecting at the cap', async () => {
      const client = Keypair.random();
      // Issue well past the cap (default 5); each call must succeed (no lockout).
      for (let i = 0; i < 8; i++) {
        await expect(service.buildChallenge(client.publicKey())).resolves.toBeDefined();
      }
      // Outstanding count is bounded at the cap; oldest were evicted.
      expect(repo.outstanding(client.publicKey()).length).toBe(cfg.maxOutstandingChallenges);
    });
  });

  describe('verify', () => {
    async function issueSignedChallenge(client: Keypair): Promise<string> {
      const { challengeTxXdr } = await service.buildChallenge(client.publicKey());
      return signXdr(challengeTxXdr, client);
    }

    it('verifies a correctly signed challenge and issues tokens', async () => {
      const client = Keypair.random();
      const signed = await issueSignedChallenge(client);

      const tokens = await service.verify(signed);

      expect(tokens.accessToken).toBe('access.jwt');
      expect(tokens.refreshToken).toBe('refresh.jwt');
      // challenge is now single-use consumed
      const [row] = [...repo.rows.values()];
      expect(row.consumedAt).not.toBeNull();
    });

    it('rejects an unknown challenge with AUTH_CHALLENGE_NOT_FOUND', async () => {
      const client = Keypair.random();
      // Build a challenge OUTSIDE the service so it is never persisted.
      const xdr = WebAuth.buildChallengeTx(
        serverKeypair,
        client.publicKey(),
        'tove.io',
        300,
        NETWORK,
        'auth.tove.io',
      );
      await expect(service.verify(signXdr(xdr, client))).rejects.toMatchObject({
        response: { errorCode: ErrorCode.AUTH_CHALLENGE_NOT_FOUND },
      });
    });

    it('rejects a re-submitted (already consumed) challenge', async () => {
      const client = Keypair.random();
      const signed = await issueSignedChallenge(client);
      await service.verify(signed);
      await expect(service.verify(signed)).rejects.toMatchObject({
        response: { errorCode: ErrorCode.AUTH_CHALLENGE_ALREADY_USED },
      });
    });

    it('rejects an expired challenge', async () => {
      const client = Keypair.random();
      const { challengeTxXdr } = await service.buildChallenge(client.publicKey());
      // Force expiry on the stored row.
      const [row] = [...repo.rows.values()];
      row.expiresAt = new Date(Date.now() - 1000);
      await expect(service.verify(signXdr(challengeTxXdr, client))).rejects.toMatchObject({
        response: { errorCode: ErrorCode.AUTH_CHALLENGE_EXPIRED },
      });
    });

    it('rejects a challenge signed by the wrong key', async () => {
      const client = Keypair.random();
      const attacker = Keypair.random();
      const { challengeTxXdr } = await service.buildChallenge(client.publicKey());
      // Signed by attacker, but the stored challenge is bound to `client`.
      await expect(service.verify(signXdr(challengeTxXdr, attacker))).rejects.toMatchObject({
        response: { errorCode: ErrorCode.AUTH_SIGNATURE_INVALID },
      });
    });

    it('rejects malformed XDR', async () => {
      await expect(service.verify('not-a-valid-xdr')).rejects.toMatchObject({
        response: { errorCode: ErrorCode.AUTH_SIGNATURE_INVALID },
      });
    });
  });
});
