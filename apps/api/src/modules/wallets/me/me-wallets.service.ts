import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ErrorCode } from '@common/enums/error-code.enum';
import { failHttp } from '@common/http/fail-http';
import { IdempotencyStore } from '@common/idempotency/idempotency-store';
import { Sep10Service } from '@modules/auth/sep10.service';
import { Sep10ChallengeResponseDto } from '@modules/auth/dto/sep10-challenge-response.dto';
import { AuditLogService } from '../audit/audit-log.service';
import { AUDIT_KIND } from '../audit/audit-log.types';
import { WalletsService } from '../wallets.service';
import { WalletMutationError, WalletMutationReason } from '../wallet-mutation.error';
import { AddWalletDto } from './dto/add-wallet.dto';
import { MeWalletDto } from './dto/me-wallet.dto';
import { DeleteWalletResponseDto } from './dto/delete-wallet-response.dto';

/**
 * Neutral wallet-mutation reason → (ErrorCode, HTTP status), exhaustive by construction — a new
 * `WalletMutationReason` without a mapping is a compile error here (mirrors `transfer-error-http.ts`).
 */
const MUTATION_ERROR_MAP: Record<WalletMutationReason, [ErrorCode, HttpStatus]> = {
  already_bound: [ErrorCode.WALLET_ALREADY_BOUND, HttpStatus.CONFLICT],
  challenge_consumed: [ErrorCode.AUTH_CHALLENGE_ALREADY_USED, HttpStatus.UNAUTHORIZED],
  kind_not_supported: [ErrorCode.WALLET_KIND_NOT_SUPPORTED, HttpStatus.UNPROCESSABLE_ENTITY],
  not_eligible_for_primary: [ErrorCode.WALLET_NOT_ELIGIBLE_FOR_PRIMARY, HttpStatus.CONFLICT],
  not_found: [ErrorCode.WALLET_NOT_FOUND, HttpStatus.NOT_FOUND],
  primary_cannot_be_removed: [ErrorCode.PRIMARY_WALLET_CANNOT_BE_REMOVED, HttpStatus.CONFLICT],
};

/**
 * Authenticated `me/wallets` identity surface (TOV-24): issue a user-bound SEP-10 challenge, bind a new
 * BYOW wallet (idempotent), and remove one. Orchestration only — the SEP-10 crypto lives in
 * {@link Sep10Service} and the atomic persistence in {@link WalletsService}; this service wires them,
 * enforces the `Idempotency-Key`, and maps neutral {@link WalletMutationError}s to HTTP via `failHttp`.
 */
@Injectable()
export class MeWalletsService {
  constructor(
    private readonly sep10Service: Sep10Service,
    private readonly walletsService: WalletsService,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditLogService,
  ) {}

  /** Issue a challenge stamped with the caller's id, to be signed and submitted to {@link add}. */
  issueChallenge(userId: string, publicKey: string): Promise<Sep10ChallengeResponseDto> {
    return this.sep10Service.buildChallenge(publicKey, userId);
  }

  /**
   * Bind a new BYOW wallet to the caller. Idempotent on `idempotencyKey`: a same-body retry replays the
   * original 201 (the SEP-10 challenge is single-use, so without this a retry would hit a confusing
   * ALREADY_USED), an in-flight duplicate is 409, and a same-key/different-body reuse is 422.
   */
  async add(userId: string, idempotencyKey: string, dto: AddWalletDto): Promise<MeWalletDto> {
    // `idempotencyKey` is presence/charset-validated at the edge by IdempotencyKeyPipe.
    const key = `idem:me-wallets-add:${userId}:${idempotencyKey}`;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ signedChallengeXdr: dto.signedChallengeXdr }))
      .digest('hex');

    const begin = await this.idempotency.begin(key, fingerprint);
    if (begin.outcome === 'mismatch') {
      throw failHttp(
        ErrorCode.IDEMPOTENCY_KEY_MISMATCH,
        HttpStatus.UNPROCESSABLE_ENTITY,
        'Idempotency-Key reused with a different request body',
      );
    }
    if (begin.outcome === 'in_flight') {
      throw failHttp(
        ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT,
        HttpStatus.CONFLICT,
        'A request with this Idempotency-Key is already in progress',
      );
    }
    if (begin.outcome === 'replay') {
      return this.replay(userId, begin.body);
    }

    try {
      const { publicKey, consume } = await this.sep10Service.verifyBindChallenge(
        dto.signedChallengeXdr,
        userId,
      );
      const wallet = await this.walletsService.bindByowWalletToUser(userId, publicKey, consume);
      await this.idempotency.complete(key, begin.token, { walletId: wallet.id });
      return MeWalletDto.fromEntity(wallet);
    } catch (err) {
      await this.idempotency.fail(key, begin.token);
      if (err instanceof WalletMutationError) throw this.mapMutationError(err);
      throw err; // SEP-10 UnauthorizedException (invalid/expired/foreign challenge) passes through
    }
  }

  /**
   * Set an owned wallet as the caller's primary settlement wallet (TOV-25). Idempotent: re-setting the
   * current primary returns 200 with NO audit row. A real change records a `PRIMARY_CHANGED` audit row
   * inside the swap transaction (atomic). Neutral {@link WalletMutationError}s map to HTTP via `failHttp`.
   *
   * Audit is FAIL-CLOSED for primary changes: the audit row is written with the transaction `manager`, so
   * an audit-write failure propagates (a non-`WalletMutationError` ⇒ generic 500) and rolls the swap back.
   * This is intentional and SAFE — unlike the export money path (which fails open because an on-chain action
   * already succeeded), a primary change has no on-chain side effect, so refusing the operation when its
   * audit cannot be recorded keeps the settlement-wallet audit trail gap-free. (TOV-25 #162)
   */
  async setPrimary(userId: string, walletId: string): Promise<MeWalletDto> {
    try {
      const wallet = await this.walletsService.setPrimaryWallet(
        userId,
        walletId,
        async (result, manager) => {
          if (!result.changed) return; // idempotent no-op → no audit row
          await this.audit.record(
            {
              actorType: 'user',
              actorId: userId,
              kind: AUDIT_KIND.PRIMARY_CHANGED,
              subjectType: 'wallet',
              subjectId: walletId,
              payload: {
                previousWalletId: result.previousWalletId,
                newWalletId: walletId,
                reason: 'user',
              },
            },
            manager,
          );
        },
      );
      return MeWalletDto.fromEntity(wallet);
    } catch (err) {
      if (err instanceof WalletMutationError) throw this.mapMutationError(err);
      throw err;
    }
  }

  /**
   * Soft-unbind an owned wallet (byow-only). When the target is primary, the oldest eligible sibling is
   * auto-promoted (recording a `PRIMARY_CHANGED` audit row with `reason: 'auto_promote'` inside the tx);
   * only when no eligible sibling exists is the delete refused (409). Returns the deleted id and the
   * auto-promoted wallet (or null) so the caller learns the new settlement wallet without a re-fetch (#160).
   */
  async remove(userId: string, walletId: string): Promise<DeleteWalletResponseDto> {
    try {
      const result = await this.walletsService.removeWallet(
        userId,
        walletId,
        async (reassigned, manager) => {
          await this.audit.record(
            {
              actorType: 'user',
              actorId: userId,
              kind: AUDIT_KIND.PRIMARY_CHANGED,
              subjectType: 'wallet',
              subjectId: reassigned.newWalletId,
              payload: {
                previousWalletId: reassigned.previousWalletId,
                newWalletId: reassigned.newWalletId,
                reason: 'auto_promote',
              },
            },
            manager,
          );
        },
      );
      return { deletedId: walletId, newPrimaryWalletId: result.promotedWalletId };
    } catch (err) {
      if (err instanceof WalletMutationError) throw this.mapMutationError(err);
      throw err;
    }
  }

  /** Owner-scoped replay of a completed add (never a bare id lookup). */
  private async replay(userId: string, body: unknown): Promise<MeWalletDto> {
    const walletId = this.walletIdFrom(body);
    const wallet = walletId ? await this.walletsService.findOwnedWallet(userId, walletId) : null;
    if (!wallet) throw failHttp(ErrorCode.WALLET_NOT_FOUND, HttpStatus.NOT_FOUND, 'Wallet request failed');
    return MeWalletDto.fromEntity(wallet);
  }

  private walletIdFrom(body: unknown): string | null {
    if (typeof body === 'object' && body !== null && 'walletId' in body) {
      const id = (body as { walletId?: unknown }).walletId;
      return typeof id === 'string' ? id : null;
    }
    return null;
  }

  private mapMutationError(err: WalletMutationError): HttpException {
    const [errorCode, status] = MUTATION_ERROR_MAP[err.reason];
    return failHttp(errorCode, status, 'Wallet request failed');
  }
}
