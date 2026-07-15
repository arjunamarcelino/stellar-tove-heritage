import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import type { PasskeyChallenge } from '../../../../src/modules/auth/entities/passkey-challenge.entity';
import type { IPasskeyChallengeRepository } from '../../../../src/modules/auth/repositories/passkey-challenge-repository.interface';
import type { UsersService } from '../../../../src/modules/users/users.service';
import type { WalletsService } from '../../../../src/modules/wallets/wallets.service';
import type { AuthService } from '../../../../src/modules/auth/auth.service';
import { PasskeyService } from '../../../../src/modules/auth/passkey.service';
import { decodeCoseToRawP256 } from '../../../../src/modules/auth/passkey.helpers';
import { createSoftwarePasskey, buildAttestation } from '../../../shared/webauthn-authenticator';
import { FakeRelayerService } from '../../../shared/fake-relayer';
import { WalletBindError } from '../../../../src/modules/wallets/wallet-bind.error';

// generate/verify are mocked; the /helpers subpath (cose, decode) stays REAL so
// decodeCoseToRawP256 runs against genuine COSE keys.
const { mockGenerate, mockVerify } = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
  mockVerify: vi.fn(),
}));
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: mockGenerate,
  verifyRegistrationResponse: mockVerify,
}));

class FakeChallengeRepo implements IPasskeyChallengeRepository {
  rows = new Map<string, PasskeyChallenge>();
  seed(row: { email: string; challenge: string; expiresAt: Date; consumedAt?: Date | null }): void {
    this.rows.set(row.challenge, {
      id: `id-${row.challenge}`,
      email: row.email,
      challenge: row.challenge,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt ?? null,
      createdAt: new Date(),
    });
  }
  create(input: { email: string; challenge: string; expiresAt: Date }): Promise<PasskeyChallenge> {
    this.seed(input);
    return Promise.resolve(this.rows.get(input.challenge)!);
  }
  findByChallenge(challenge: string): Promise<PasskeyChallenge | null> {
    return Promise.resolve(this.rows.get(challenge) ?? null);
  }
  consumeByChallenge(challenge: string): Promise<boolean> {
    const row = this.rows.get(challenge);
    if (row && !row.consumedAt) {
      row.consumedAt = new Date();
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }
  pruneOutstandingByEmail(): Promise<void> {
    return Promise.resolve();
  }
  deleteExpired(): Promise<void> {
    return Promise.resolve();
  }
}

const cfg = {
  rpId: 'tove.io',
  rpName: 'Tove',
  origins: ['https://tove.io'],
  challengeTimeout: 300,
  maxOutstandingChallenges: 5,
};

const future = () => new Date(Date.now() + 300_000);
const past = () => new Date(Date.now() - 60_000);

describe('PasskeyService', () => {
  let challenges: FakeChallengeRepo;
  let relayer: FakeRelayerService;
  let usersService: { findByEmail: ReturnType<typeof vi.fn> };
  let walletsService: {
    findByCredentialId: ReturnType<typeof vi.fn>;
    createEmbeddedPasskeyWallet: ReturnType<typeof vi.fn>;
  };
  let authService: { issueTokensForUser: ReturnType<typeof vi.fn> };
  let service: PasskeyService;

  beforeEach(() => {
    vi.clearAllMocks();
    challenges = new FakeChallengeRepo();
    relayer = new FakeRelayerService();
    usersService = { findByEmail: vi.fn().mockResolvedValue(null) };
    walletsService = {
      findByCredentialId: vi.fn().mockResolvedValue(null),
      createEmbeddedPasskeyWallet: vi
        .fn()
        .mockResolvedValue({ user: { id: 'u1', email: 'user@example.com' } }),
    };
    authService = {
      issueTokensForUser: vi
        .fn()
        .mockResolvedValue({ accessToken: 'access.jwt', refreshToken: 'refresh.jwt' }),
    };
    service = new PasskeyService(
      cfg,
      challenges,
      relayer,
      usersService as unknown as UsersService,
      walletsService as unknown as WalletsService,
      authService as unknown as AuthService,
    );
  });

  // Build a dto + a matching verified() result for a given challenge/email.
  function scenario(email: string, challenge: string) {
    const passkey = createSoftwarePasskey();
    const attestation = buildAttestation({ passkey, challenge, rpId: cfg.rpId, origin: cfg.origins[0] });
    const verified = {
      verified: true,
      registrationInfo: {
        credential: {
          id: attestation.id,
          publicKey: passkey.cosePublicKey,
          counter: 0,
          transports: ['internal'],
        },
      },
    };
    return { passkey, dto: { email, attestationResponse: attestation }, verified };
  }

  describe('begin', () => {
    it('rejects an already-registered email with AUTH_EMAIL_CONFLICT', async () => {
      usersService.findByEmail.mockResolvedValue({ id: 'x' });
      await expect(service.begin('taken@example.com')).rejects.toMatchObject({
        response: { errorCode: ErrorCode.AUTH_EMAIL_CONFLICT },
      });
    });

    it('generates options and persists the challenge', async () => {
      mockGenerate.mockResolvedValue({ challenge: 'chal-new', rp: { id: 'tove.io' } });
      const result = await service.begin('new@example.com');
      expect(result.options).toMatchObject({ challenge: 'chal-new' });
      expect(await challenges.findByChallenge('chal-new')).not.toBeNull();
    });
  });

  describe('finish', () => {
    it('happy path: verifies, deploys with the decoded P-256 key, binds, issues tokens', async () => {
      const { dto, verified, passkey } = scenario('user@example.com', 'chal-1');
      challenges.seed({ email: 'user@example.com', challenge: 'chal-1', expiresAt: future() });
      mockVerify.mockResolvedValue(verified);

      const tokens = await service.finish(dto);

      expect(tokens).toMatchObject({ accessToken: 'access.jwt', refreshToken: 'refresh.jwt' });
      // 201 returns the deployed smart-wallet address (from the deploy, no extra chain call).
      expect(tokens.contractAddress).toMatch(/^C.{55}$/);
      // deploy received the exact 65-byte 0x04||x||y decoded from the credential.
      expect(relayer.calls).toHaveLength(1);
      expect(Buffer.from(relayer.calls[0].secp256r1PublicKey)).toEqual(
        Buffer.from(decodeCoseToRawP256(passkey.cosePublicKey)),
      );
      expect(walletsService.createEmbeddedPasskeyWallet).toHaveBeenCalledTimes(1);
    });

    it('challenge not found -> AUTH_CHALLENGE_NOT_FOUND', async () => {
      const { dto } = scenario('user@example.com', 'missing');
      mockVerify.mockResolvedValue({ verified: true });
      await expect(service.finish(dto as never)).rejects.toMatchObject({
        response: { errorCode: ErrorCode.AUTH_CHALLENGE_NOT_FOUND },
      });
    });

    it('expired challenge -> AUTH_CHALLENGE_EXPIRED', async () => {
      const { dto, verified } = scenario('user@example.com', 'chal-exp');
      challenges.seed({ email: 'user@example.com', challenge: 'chal-exp', expiresAt: past() });
      mockVerify.mockResolvedValue(verified);
      await expect(service.finish(dto as never)).rejects.toMatchObject({
        response: { errorCode: ErrorCode.AUTH_CHALLENGE_EXPIRED },
      });
    });

    it('consumed challenge -> AUTH_CHALLENGE_ALREADY_USED', async () => {
      const { dto, verified } = scenario('user@example.com', 'chal-used');
      challenges.seed({
        email: 'user@example.com',
        challenge: 'chal-used',
        expiresAt: future(),
        consumedAt: new Date(),
      });
      mockVerify.mockResolvedValue(verified);
      await expect(service.finish(dto as never)).rejects.toMatchObject({
        response: { errorCode: ErrorCode.AUTH_CHALLENGE_ALREADY_USED },
      });
    });

    it('email on challenge != dto.email -> VERIFICATION_FAILED', async () => {
      const { dto, verified } = scenario('user@example.com', 'chal-mm');
      challenges.seed({ email: 'other@example.com', challenge: 'chal-mm', expiresAt: future() });
      mockVerify.mockResolvedValue(verified);
      await expect(service.finish(dto as never)).rejects.toMatchObject({
        response: { errorCode: ErrorCode.AUTH_PASSKEY_VERIFICATION_FAILED },
      });
    });

    it('verify fails -> VERIFICATION_FAILED and challenge stays unconsumed', async () => {
      const { dto } = scenario('user@example.com', 'chal-vf');
      challenges.seed({ email: 'user@example.com', challenge: 'chal-vf', expiresAt: future() });
      mockVerify.mockResolvedValue({ verified: false });
      await expect(service.finish(dto as never)).rejects.toMatchObject({
        response: { errorCode: ErrorCode.AUTH_PASSKEY_VERIFICATION_FAILED },
      });
      expect(challenges.rows.get('chal-vf')?.consumedAt).toBeNull();
      expect(relayer.calls).toHaveLength(0);
    });

    it('malformed clientDataJSON -> VERIFICATION_FAILED (not 500)', async () => {
      const dto = {
        email: 'user@example.com',
        attestationResponse: {
          id: 'x',
          rawId: 'x',
          type: 'public-key',
          clientExtensionResults: {},
          response: {
            clientDataJSON: Buffer.from('not-json').toString('base64url'),
            attestationObject: 'y',
          },
        },
      };
      await expect(service.finish(dto as never)).rejects.toMatchObject({
        response: { errorCode: ErrorCode.AUTH_PASSKEY_VERIFICATION_FAILED },
      });
    });

    it('wrong-curve COSE key -> VERIFICATION_FAILED', async () => {
      const { dto } = scenario('user@example.com', 'chal-wc');
      challenges.seed({ email: 'user@example.com', challenge: 'chal-wc', expiresAt: future() });
      mockVerify.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: { id: 'x', publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
        },
      });
      await expect(service.finish(dto as never)).rejects.toMatchObject({
        response: { errorCode: ErrorCode.AUTH_PASSKEY_VERIFICATION_FAILED },
      });
    });

    it('credential already bound to a different email -> PASSKEY_ALREADY_BOUND', async () => {
      const { dto, verified } = scenario('user@example.com', 'chal-ab');
      challenges.seed({ email: 'user@example.com', challenge: 'chal-ab', expiresAt: future() });
      mockVerify.mockResolvedValue(verified);
      walletsService.findByCredentialId.mockResolvedValue({
        wallet: { user: { id: 'other', email: 'other@example.com' }, contractAddress: 'COTHER' },
      });
      await expect(service.finish(dto as never)).rejects.toMatchObject({
        response: { errorCode: ErrorCode.PASSKEY_ALREADY_BOUND },
      });
      expect(relayer.calls).toHaveLength(0);
    });

    it('idempotent replay: same credential + email re-issues tokens without deploying', async () => {
      const { dto, verified } = scenario('user@example.com', 'chal-rp');
      challenges.seed({ email: 'user@example.com', challenge: 'chal-rp', expiresAt: future() });
      mockVerify.mockResolvedValue(verified);
      walletsService.findByCredentialId.mockResolvedValue({
        wallet: { user: { id: 'u9', email: 'user@example.com' }, contractAddress: 'CREPLAYADDRESS' },
      });
      const tokens = await service.finish(dto);
      // replay returns the SAME already-deployed address, no deploy.
      expect(tokens).toEqual({
        accessToken: 'access.jwt',
        refreshToken: 'refresh.jwt',
        contractAddress: 'CREPLAYADDRESS',
      });
      expect(authService.issueTokensForUser).toHaveBeenCalledWith({
        id: 'u9',
        email: 'user@example.com',
      });
      expect(relayer.calls).toHaveLength(0);
      expect(walletsService.createEmbeddedPasskeyWallet).not.toHaveBeenCalled();
    });

    it('deploy failure -> WALLET_DEPLOY_FAILED, nothing bound, challenge stays live', async () => {
      const { dto, verified } = scenario('user@example.com', 'chal-df');
      challenges.seed({ email: 'user@example.com', challenge: 'chal-df', expiresAt: future() });
      mockVerify.mockResolvedValue(verified);
      relayer.failNext();
      await expect(service.finish(dto as never)).rejects.toMatchObject({
        response: { errorCode: ErrorCode.WALLET_DEPLOY_FAILED },
      });
      expect(walletsService.createEmbeddedPasskeyWallet).not.toHaveBeenCalled();
      expect(challenges.rows.get('chal-df')?.consumedAt).toBeNull();
    });

    it.each([
      ['challenge_consumed', ErrorCode.AUTH_CHALLENGE_ALREADY_USED],
      ['passkey_already_bound', ErrorCode.PASSKEY_ALREADY_BOUND],
      ['email_conflict', ErrorCode.AUTH_EMAIL_CONFLICT],
    ] as const)('maps WalletBindError(%s) from the bind step', async (reason, errorCode) => {
      const { dto, verified } = scenario('user@example.com', `chal-${reason}`);
      challenges.seed({ email: 'user@example.com', challenge: `chal-${reason}`, expiresAt: future() });
      mockVerify.mockResolvedValue(verified);
      walletsService.createEmbeddedPasskeyWallet.mockRejectedValue(new WalletBindError(reason));
      await expect(service.finish(dto as never)).rejects.toMatchObject({ response: { errorCode } });
    });
  });
});
