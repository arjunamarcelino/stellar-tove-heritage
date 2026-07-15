import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import { cose } from '@simplewebauthn/server/helpers';
import { ErrorCode } from '@common/enums/error-code.enum';
import { webauthnConfig } from '@config/webauthn.config';
import { UsersService } from '@modules/users/users.service';
import { WalletsService } from '@modules/wallets/wallets.service';
import { WalletBindError } from '@modules/wallets/wallet-bind.error';
import { AuthService } from './auth.service';
import {
  PASSKEY_CHALLENGE_REPOSITORY,
  IPasskeyChallengeRepository,
} from './repositories/passkey-challenge-repository.interface';
import {
  RELAYER_SERVICE,
  IRelayerService,
} from '@modules/relayer/relayer.service.interface';
import { PasskeyRegisterFinishDto } from './dto/passkey-register-finish.dto';
import { PasskeyRegistrationOptionsResponseDto } from './dto/passkey-registration-options-response.dto';
import { extractClientChallenge, decodeCoseToRawP256 } from './passkey.helpers';

type Tokens = { accessToken: string; refreshToken: string };
type FinishResult = Tokens & { contractAddress: string };

@Injectable()
export class PasskeyService {
  private readonly logger = new Logger(PasskeyService.name);

  constructor(
    @Inject(webauthnConfig.KEY)
    private readonly cfg: ConfigType<typeof webauthnConfig>,
    @Inject(PASSKEY_CHALLENGE_REPOSITORY)
    private readonly challenges: IPasskeyChallengeRepository,
    @Inject(RELAYER_SERVICE)
    private readonly relayer: IRelayerService,
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly authService: AuthService,
  ) {}

  /** Issue a WebAuthn (ES256/P-256 only) registration challenge for a new email. */
  async begin(email: string): Promise<PasskeyRegistrationOptionsResponseDto> {
    if (await this.usersService.findByEmail(email)) {
      throw this.fail(ErrorCode.AUTH_EMAIL_CONFLICT, HttpStatus.CONFLICT);
    }

    const options = await generateRegistrationOptions({
      rpName: this.cfg.rpName,
      rpID: this.cfg.rpId,
      userName: email,
      userID: randomBytes(32), // opaque, non-PII; not persisted (discoverable credential)
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
        authenticatorAttachment: 'platform',
      },
      supportedAlgorithmIDs: [cose.COSEALG.ES256],
      timeout: this.cfg.challengeTimeout * 1000,
    });

    // Evict the caller's oldest outstanding challenges BEFORE inserting, so the total
    // is bounded at exactly maxOutstandingChallenges (matches the SEP-10 ordering).
    await this.challenges.pruneOutstandingByEmail(
      email,
      Math.max(this.cfg.maxOutstandingChallenges - 1, 0),
    );
    await this.challenges.create({
      email,
      challenge: options.challenge,
      expiresAt: new Date(Date.now() + this.cfg.challengeTimeout * 1000),
    });
    this.sweepExpiredChallenges();

    return PasskeyRegistrationOptionsResponseDto.create(options);
  }

  /** Verify the attestation, deploy the smart wallet, and bind the account. */
  async finish(dto: PasskeyRegisterFinishDto): Promise<FinishResult> {
    let clientChallenge: string;
    try {
      clientChallenge = extractClientChallenge(dto.attestationResponse);
    } catch {
      throw this.verificationFailed();
    }

    const row = await this.challenges.findByChallenge(clientChallenge);
    if (!row) {
      throw this.fail(ErrorCode.AUTH_CHALLENGE_NOT_FOUND, HttpStatus.UNAUTHORIZED);
    }
    if (row.email.toLowerCase() !== dto.email.toLowerCase()) {
      throw this.verificationFailed();
    }

    // Verify BEFORE consuming (a forged/failed attestation must not burn a live challenge).
    let verification: VerifiedRegistrationResponse;
    try {
      verification = await verifyRegistrationResponse({
        response: dto.attestationResponse,
        expectedChallenge: row.challenge,
        expectedOrigin: this.cfg.origins,
        expectedRPID: this.cfg.rpId,
        requireUserVerification: true,
        supportedAlgorithmIDs: [cose.COSEALG.ES256],
      });
    } catch {
      throw this.verificationFailed();
    }
    if (!verification.verified || !verification.registrationInfo) {
      throw this.verificationFailed();
    }

    const cred = verification.registrationInfo.credential;
    let secp256r1PublicKey: Uint8Array;
    try {
      secp256r1PublicKey = decodeCoseToRawP256(cred.publicKey);
    } catch {
      throw this.verificationFailed();
    }

    // Cheap fast-fail pre-checks (the unique constraints remain the real guard).
    const [existingCred, emailUser] = await Promise.all([
      this.walletsService.findByCredentialId(cred.id),
      this.usersService.findByEmail(dto.email),
    ]);

    // Idempotent replay: a completed registration re-submitted (same credential + email)
    // re-issues tokens rather than failing -- checked BEFORE the challenge state so a
    // lost-response retry (challenge already consumed) still succeeds. Gated behind the
    // passing verify above, so it is NOT a forgery oracle (an attacker cannot mint tokens
    // for an arbitrary account -- they must hold that user's own validly-signed finish body).
    // RESIDUAL RISK (accepted for testnet, see auth/CLAUDE.md + todo 097): within the challenge
    // window (~5 min, until deleteExpired sweeps the row) a captured finish body can re-mint fresh
    // tokens, which survives refresh-token revocation. Closing this (Idempotency-Key bound at
    // begin) is gated on the mainnet money-surface controls, not built here.
    if (existingCred) {
      const boundUser = existingCred.wallet.user;
      const existingAddress = existingCred.wallet.contractAddress;
      if (existingAddress && boundUser.email && boundUser.email.toLowerCase() === dto.email.toLowerCase()) {
        this.logger.log(`Idempotent passkey replay [user=${boundUser.id}]`);
        const tokens = await this.authService.issueTokensForUser({ id: boundUser.id, email: boundUser.email });
        return { ...tokens, contractAddress: existingAddress };
      }
      // A passkey-bound wallet should always carry its deployed address; a null here is a data
      // anomaly (bind persisted without the deploy result). Surface it rather than silently masking
      // the replay as a 409.
      if (!existingAddress) {
        this.logger.warn(
          `passkey-bound wallet has no contract address [wallet=${existingCred.wallet.id} user=${boundUser.id}]`,
        );
      }
      throw this.fail(ErrorCode.PASSKEY_ALREADY_BOUND, HttpStatus.CONFLICT);
    }

    // Challenge state (after the replay check): a genuinely reused/expired challenge that
    // is NOT a same-credential replay is rejected here.
    if (row.consumedAt) {
      throw this.fail(ErrorCode.AUTH_CHALLENGE_ALREADY_USED, HttpStatus.UNAUTHORIZED);
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw this.fail(ErrorCode.AUTH_CHALLENGE_EXPIRED, HttpStatus.UNAUTHORIZED);
    }
    if (emailUser) {
      throw this.fail(ErrorCode.AUTH_EMAIL_CONFLICT, HttpStatus.CONFLICT);
    }

    // Deploy BEFORE any DB write: on failure nothing is persisted and the challenge
    // stays live/retryable. Idempotent via deterministic salt.
    let contractAddress: string;
    try {
      const deployed = await this.relayer.deployPasskeyWallet({
        credentialId: cred.id,
        secp256r1PublicKey,
      });
      contractAddress = deployed.contractAddress;
      // Record the tx hash — a fee-spending deploy must be auditable.
      this.logger.log(`Smart wallet deployed [contract=${contractAddress} tx=${deployed.txHash}]`);
    } catch (err) {
      this.logger.error(`Smart-wallet deploy failed: ${String(err)}`);
      throw this.fail(ErrorCode.WALLET_DEPLOY_FAILED, HttpStatus.SERVICE_UNAVAILABLE);
    }

    let bindResult: Awaited<ReturnType<WalletsService['createEmbeddedPasskeyWallet']>>;
    try {
      bindResult = await this.walletsService.createEmbeddedPasskeyWallet(
        {
          email: dto.email,
          contractAddress,
          credential: {
            id: cred.id,
            publicKey: Buffer.from(cred.publicKey),
            counter: cred.counter,
            transports: cred.transports,
          },
        },
        (manager) => this.challenges.consumeByChallenge(row.challenge, manager),
      );
    } catch (err) {
      if (err instanceof WalletBindError) {
        throw this.mapBindError(err);
      }
      throw err;
    }

    this.sweepExpiredChallenges();
    const tokens = await this.authService.issueTokensForUser({
      id: bindResult.user.id,
      email: bindResult.user.email,
    });
    return { ...tokens, contractAddress };
  }

  /** Map a wallets-domain bind failure to the HTTP status + errorCode for this surface. */
  private mapBindError(err: WalletBindError): HttpException {
    switch (err.reason) {
      case 'challenge_consumed':
        return this.fail(ErrorCode.AUTH_CHALLENGE_ALREADY_USED, HttpStatus.UNAUTHORIZED);
      case 'passkey_already_bound':
        return this.fail(ErrorCode.PASSKEY_ALREADY_BOUND, HttpStatus.CONFLICT);
      case 'email_conflict':
        return this.fail(ErrorCode.AUTH_EMAIL_CONFLICT, HttpStatus.CONFLICT);
    }
  }

  /** Fire-and-forget expired-challenge sweep; never blocks or throws into the request. */
  private sweepExpiredChallenges(): void {
    void this.challenges
      .deleteExpired()
      .catch((err) => this.logger.warn(`challenge sweep failed: ${String(err)}`));
  }

  private verificationFailed(): HttpException {
    return this.fail(ErrorCode.AUTH_PASSKEY_VERIFICATION_FAILED, HttpStatus.UNAUTHORIZED);
  }

  private fail(errorCode: ErrorCode, status: HttpStatus): HttpException {
    // Use the standard Nest reason phrase (not the all-caps enum key) so the body's
    // `error` field matches the SEP-10 / wallets sibling endpoints.
    const reason =
      status === HttpStatus.UNAUTHORIZED
        ? 'Unauthorized'
        : status === HttpStatus.CONFLICT
          ? 'Conflict'
          : status === HttpStatus.SERVICE_UNAVAILABLE
            ? 'Service Unavailable'
            : 'Error';
    return new HttpException(
      { statusCode: status, error: reason, message: 'Passkey registration failed', errorCode },
      status,
    );
  }
}
