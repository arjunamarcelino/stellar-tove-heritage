import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import {
  Keypair,
  TransactionBuilder,
  WebAuth,
  Transaction,
} from '@stellar/stellar-sdk';
import { EntityManager } from 'typeorm';
import { ErrorCode } from '@common/enums/error-code.enum';
import { sep10Config } from '@config/sep10.config';
import { WalletsService } from '@modules/wallets/wallets.service';
import { AuthService } from './auth.service';
import { AuthChallenge } from './entities/auth-challenge.entity';
import { Sep10ChallengeResponseDto } from './dto/sep10-challenge-response.dto';
import {
  AUTH_CHALLENGE_REPOSITORY,
  IAuthChallengeRepository,
} from './repositories/auth-challenge-repository.interface';

/**
 * SEP-10 (Stellar Web Auth) challenge + verify. The server signs a throwaway
 * challenge transaction; the wallet signs it back, proving key ownership. We
 * verify signatures OFFLINE (master-key, no Horizon) so unfunded BYOW wallets
 * still authenticate.
 */
@Injectable()
export class Sep10Service {
  private readonly logger = new Logger(Sep10Service.name);
  private readonly serverKeypair: Keypair;

  constructor(
    @Inject(sep10Config.KEY) private readonly cfg: ConfigType<typeof sep10Config>,
    @Inject(AUTH_CHALLENGE_REPOSITORY)
    private readonly challenges: IAuthChallengeRepository,
    private readonly walletsService: WalletsService,
    private readonly authService: AuthService,
  ) {
    this.serverKeypair = Keypair.fromSecret(this.cfg.serverSigningSecret);
  }

  /**
   * Issue a SEP-10 challenge for `publicKey`. `userId` binds the challenge to an authenticated Collector
   * for the wallet-ADD flow (TOV-24) — verify then asserts the caller owns it, so a leaked/misdirected
   * signed XDR cannot bind the key to another account. Anonymous LOGIN challenges pass `userId = null`.
   */
  async buildChallenge(
    publicKey: string,
    userId: string | null = null,
  ): Promise<Sep10ChallengeResponseDto> {
    // Evict the oldest outstanding challenges (keep cap-1) so issuing this fresh
    // one never exceeds the cap. Unlike a hard reject, this can't be abused to
    // lock a victim out by spamming challenges for their (public) key — a new
    // challenge is harmless because verify still requires the private key.
    await this.challenges.pruneOutstanding(publicKey, this.cfg.maxOutstandingChallenges - 1);

    const challengeTxXdr = WebAuth.buildChallengeTx(
      this.serverKeypair,
      publicKey,
      this.cfg.homeDomain,
      this.cfg.challengeTimeout,
      this.cfg.networkPassphrase,
      this.cfg.webAuthDomain,
    );

    // Hash our OWN server-built XDR directly (trusted): a failure here is server
    // misconfiguration, so let it surface as 5xx rather than parseChallenge's
    // 401 AUTH_SIGNATURE_INVALID (which is for untrusted client submissions).
    const txHash = TransactionBuilder.fromXDR(challengeTxXdr, this.cfg.networkPassphrase)
      .hash()
      .toString('hex');
    const expiresAt = new Date(Date.now() + this.cfg.challengeTimeout * 1000);
    await this.challenges.create({ publicKey, txHash, expiresAt, userId });

    // Sweep here too: abandoned flows (challenge, never verify) would otherwise
    // never reclaim expired rows since verify's sweep only runs on success.
    this.sweepExpiredChallenges();

    return Sep10ChallengeResponseDto.create({
      challengeTxXdr,
      networkPassphrase: this.cfg.networkPassphrase,
    });
  }

  async verify(signedXdr: string): Promise<{ accessToken: string; refreshToken: string }> {
    const { challenge, txHash } = await this.verifySignedChallenge(signedXdr);

    // Login authenticates against anonymous challenges only; a user-bound (wallet-add) challenge must
    // never mint a login (and vice-versa — see verifyBindChallenge). Don't reveal which check failed.
    // `?? null` normalizes an unhydrated `undefined` (defensive: the column defaults NULL) to null.
    if ((challenge.userId ?? null) !== null) throw this.authFailure(ErrorCode.AUTH_SIGNATURE_INVALID);

    // Single-use: only the request that flips pending->consumed proceeds.
    const consumed = await this.challenges.consumeByTxHash(txHash);
    if (!consumed) throw this.authFailure(ErrorCode.AUTH_CHALLENGE_ALREADY_USED);

    const { user } = await this.walletsService.findOrCreateForWallet(challenge.publicKey);
    const tokens = await this.authService.issueTokensForUser(user);

    this.logger.log(
      `SEP-10 auth success [user=${user.id} pubkey=${challenge.publicKey} tx=${txHash}]`,
    );

    this.sweepExpiredChallenges();

    return tokens;
  }

  /**
   * Wallet-add (TOV-24): verify a signed USER-BOUND challenge and return the proven public key plus a
   * tx-scoped `consume` for the caller to run inside its wallet-write transaction (atomic consume+persist).
   * Asserts the challenge was issued to `userId` — a leaked/misdirected XDR (or an anonymous login
   * challenge) fails closed with the generic signature error.
   */
  async verifyBindChallenge(
    signedXdr: string,
    userId: string,
  ): Promise<{ publicKey: string; consume: (manager: EntityManager) => Promise<boolean> }> {
    const { challenge, txHash } = await this.verifySignedChallenge(signedXdr);
    if ((challenge.userId ?? null) !== userId) throw this.authFailure(ErrorCode.AUTH_SIGNATURE_INVALID);
    return {
      publicKey: challenge.publicKey,
      consume: (manager: EntityManager) => this.challenges.consumeByTxHash(txHash, manager),
    };
  }

  /**
   * Parse + bind-to-issued-challenge + offline signature verification, WITHOUT consuming. Shared by the
   * login {@link verify} and the wallet-add {@link verifyBindChallenge}; each then applies its own
   * `user_id` ownership rule and consume policy. Verifies signatures BEFORE consuming so an unsigned/forged
   * submission cannot grief a legitimate wallet's challenge into the consumed state.
   */
  private async verifySignedChallenge(
    signedXdr: string,
  ): Promise<{ challenge: AuthChallenge; txHash: string }> {
    const txHash = this.parseChallenge(signedXdr).hash().toString('hex');

    // Bind the verification to the exact challenge we issued (by tx hash).
    const challenge = await this.challenges.findByTxHash(txHash);
    if (!challenge) throw this.authFailure(ErrorCode.AUTH_CHALLENGE_NOT_FOUND);
    if (challenge.consumedAt) throw this.authFailure(ErrorCode.AUTH_CHALLENGE_ALREADY_USED);
    if (challenge.expiresAt.getTime() < Date.now()) {
      throw this.authFailure(ErrorCode.AUTH_CHALLENGE_EXPIRED);
    }

    try {
      WebAuth.verifyChallengeTxSigners(
        signedXdr,
        this.serverKeypair.publicKey(),
        this.cfg.networkPassphrase,
        [challenge.publicKey],
        [this.cfg.homeDomain],
        this.cfg.webAuthDomain,
      );
    } catch (err) {
      this.logger.warn(
        `SEP-10 verify rejected [pubkey=${challenge.publicKey}]: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
      throw this.authFailure(ErrorCode.AUTH_SIGNATURE_INVALID);
    }

    return { challenge, txHash };
  }

  /** Best-effort, bounded sweep of expired challenges; never blocks the response. */
  private sweepExpiredChallenges(): void {
    void this.challenges.deleteExpired().catch((err: unknown) => {
      this.logger.warn(
        `auth_challenges sweep failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    });
  }

  /** Parse XDR to a plain Transaction, rejecting fee-bumps and any memo. */
  private parseChallenge(xdr: string): Transaction {
    let tx: ReturnType<typeof TransactionBuilder.fromXDR>;
    try {
      tx = TransactionBuilder.fromXDR(xdr, this.cfg.networkPassphrase);
    } catch {
      throw this.authFailure(ErrorCode.AUTH_SIGNATURE_INVALID);
    }
    if ('innerTransaction' in tx) throw this.authFailure(ErrorCode.AUTH_SIGNATURE_INVALID);
    if (tx.memo.type !== 'none') throw this.authFailure(ErrorCode.AUTH_SIGNATURE_INVALID);
    return tx;
  }

  private authFailure(errorCode: ErrorCode): UnauthorizedException {
    return new UnauthorizedException({
      statusCode: HttpStatus.UNAUTHORIZED,
      error: 'Unauthorized',
      message: 'Wallet authentication failed',
      errorCode,
    });
  }
}
