import { randomUUID, createHash } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { relayerConfig } from '@config/relayer.config';
import { webauthnConfig } from '@config/webauthn.config';
import { offeringBidConfig } from '@config/offering-bid.config';
import { ErrorCode } from '@common/enums/error-code.enum';
import { failHttp } from '@common/http/fail-http';
import { IdempotencyStore } from '@common/idempotency/idempotency-store';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { AUDIT_KIND } from '@modules/wallets/audit/audit-log.types';
import { WalletsService } from '@modules/wallets/wallets.service';
import { EmbeddedWalletNotFoundError } from '@modules/wallets/embedded-wallet-not-found.error';
import { decodeCoseToRawP256 } from '@modules/wallets/cose.helper';
import { RELAYER_SERVICE, IRelayerService } from '@modules/relayer/relayer.service.interface';
import { RelayerTransferError } from '@modules/relayer/relayer.errors';
import {
  USER_REPOSITORY,
  IUserRepository,
} from '@modules/users/repositories/user-repository.interface';
import { Offering } from '../entities/offering.entity';
import { OfferingBid } from '../entities/offering-bid.entity';
import {
  OFFERING_REPOSITORY,
  IOfferingRepository,
} from '../repositories/offering-repository.interface';
import {
  OFFERING_BID_REPOSITORY,
  IOfferingBidRepository,
} from '../repositories/offering-bid-repository.interface';
import { computeEscrowStroops } from '../constants/bid-money';
import { deriveOnChainIdemKey } from './bid-idempotency';
import { OFFERING_BID_ESCROW_QUEUE, OFFERING_BID_CANCEL_QUEUE } from './offering-bids.constants';
import { OfferingBidEscrowJob } from './offering-bid-escrow.job';
import { OfferingBidCancelJob } from './offering-bid-cancel.job';
import { PrepareBidDto } from './dto/prepare-bid.dto';
import { PrepareBidResponseDto } from './dto/prepare-bid-response.dto';
import { SubmitBidDto } from './dto/submit-bid.dto';
import { BidResponseDto } from './dto/bid-response.dto';
import { CancelBidDto } from './dto/cancel-bid.dto';
import { PrepareCancelBidResponseDto } from './dto/prepare-cancel-bid-response.dto';

const OPENED: Offering['status'] = 'opened';

type WalletResolution = Awaited<ReturnType<WalletsService['resolveEmbeddedWalletForUser']>>;

/**
 * Orchestrates the public bid surface (TOV-156, FR-05.03). `prepare` builds the passkey-signed
 * `submit_bid` (no DB write); `submit` records a `submitted` bid + enqueues the async escrow; `getMyBid`
 * reads the caller's single active bid. Validation order and idempotency mirror `BackofficeOfferingsService`:
 * money is BigInt/string throughout; the parent offering is loaded from the path uuid (server-trusted),
 * the wallet from the JWT — nothing security-relevant comes from the request body except the assertion.
 */
@Injectable()
export class OfferingBidsService {
  private readonly logger = new Logger(OfferingBidsService.name);

  constructor(
    @Inject(OFFERING_REPOSITORY) private readonly offerings: IOfferingRepository,
    @Inject(OFFERING_BID_REPOSITORY) private readonly bids: IOfferingBidRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(RELAYER_SERVICE) private readonly relayer: IRelayerService,
    @Inject(relayerConfig.KEY) private readonly relayerCfg: ConfigType<typeof relayerConfig>,
    @Inject(webauthnConfig.KEY) private readonly webauthn: ConfigType<typeof webauthnConfig>,
    @Inject(offeringBidConfig.KEY) private readonly cfg: ConfigType<typeof offeringBidConfig>,
    private readonly walletsService: WalletsService,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditLogService,
    @InjectQueue(OFFERING_BID_ESCROW_QUEUE) private readonly escrowQueue: Queue<OfferingBidEscrowJob>,
    @InjectQueue(OFFERING_BID_CANCEL_QUEUE) private readonly cancelQueue: Queue<OfferingBidCancelJob>,
  ) {}

  /** Build the unsigned submit_bid + the passkey challenge. No DB write. Balance-pre-checked. */
  async prepare(
    userId: string,
    offeringId: string,
    dto: PrepareBidDto,
    idempotencyKey: string,
  ): Promise<PrepareBidResponseDto> {
    const { escrowContract, escrowStroops } = await this.assertBiddable(userId, offeringId, dto);
    const resolution = await this.resolveWallet(userId);
    const idemHash = deriveOnChainIdemKey(offeringId, userId, idempotencyKey);

    // The USDC balance pre-check and the submit_bid build are two independent read-only Soroban calls —
    // run them concurrently to shave a round-trip off the interactive (passkey-prompt) path (todo 303). A
    // rare wasted `buildBid` simulate on an insufficient-balance reject is acceptable (read-only, no funds).
    const [, built] = await Promise.all([
      this.assertSufficientBalance(resolution.contractAddress, escrowStroops),
      this.relayer
        .buildBid({
          walletContract: resolution.contractAddress,
          escrowContract,
          tokenContract: this.relayerCfg.usdcTokenAddress,
          priceScaled: dto.price,
          count: String(dto.count),
          idempotencyKey: idemHash,
        })
        .catch((err: unknown) => {
          throw this.mapRelayerError(err);
        }),
    ]);

    return PrepareBidResponseDto.create({
      txXdr: built.txXdr,
      challenge: built.challenge,
      expiresAtLedger: built.expiresAtLedger,
      credentialId: resolution.credential.credentialId,
      transports: resolution.credential.transports,
      rpId: this.webauthn.rpId,
      escrowContract,
      escrowAmountStroops: escrowStroops,
      price: dto.price,
      count: dto.count,
    });
  }

  /** Record a `submitted` bid + enqueue the async escrow. Idempotent; returns the bid resource (201). */
  async submit(
    userId: string,
    offeringId: string,
    dto: SubmitBidDto,
    idempotencyKey: string,
  ): Promise<BidResponseDto> {
    const key = `idem:offering-bid:${userId}:${offeringId}:${idempotencyKey}`;
    const fingerprint = createHash('sha256')
      .update(`${userId}|${offeringId}|${dto.price}|${dto.count}|${dto.txXdr}`)
      .digest('hex');

    const begin = await this.idempotency.begin(key, fingerprint);
    if (begin.outcome === 'replay') {
      return begin.body as BidResponseDto;
    }
    if (begin.outcome === 'in_flight') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT, HttpStatus.CONFLICT, 'A bid with this key is still processing');
    }
    if (begin.outcome === 'mismatch') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_MISMATCH, HttpStatus.UNPROCESSABLE_ENTITY, 'Idempotency-Key reused with a different body');
    }
    const { token } = begin;

    // Fail-guarded region (todo 298, mirrors backoffice-offerings.approve): everything up to and INCLUDING
    // the committed insert. A throw here releases the idempotency key so a genuine retry can proceed. Nothing
    // past the commit runs under this guard, so fail() is NEVER called after a committed side effect.
    let bid: OfferingBid;
    let job: OfferingBidEscrowJob;
    try {
      const { escrowContract } = await this.assertBiddable(userId, offeringId, dto);
      const resolution = await this.resolveWallet(userId);
      const boundPublicKey = this.decodeBoundKey(resolution);
      // Fail fast on a stale signature (user signed after the challenge expired) → BID_CHALLENGE_EXPIRED,
      // BEFORE recording a bid, so the client re-prepares with a fresh key rather than seeing an async fail.
      try {
        await this.relayer.assertBidNotExpired(dto.txXdr);
      } catch (err) {
        throw this.mapRelayerError(err);
      }
      const idemHash = deriveOnChainIdemKey(offeringId, userId, idempotencyKey);

      bid = await this.bids.runInTransaction(async (manager) => {
        // ATOMIC MAX_BIDS enforcement (TOV-160 #319). The assertBiddable() pre-check is a fast-fail; the
        // authoritative cap lives here. Take a per-offering transaction-scoped advisory lock so concurrent
        // submits on the SAME offering serialize — otherwise N distinct collectors racing at count == max-1
        // could each pass a plain read-then-insert and push the active book over MAX_BIDS_PER_OFFERING,
        // making the offering permanently unsettleable (the on-chain close_and_settle refunds every active
        // bid in one tx). The lock forces each submit to observe the prior one's committed row.
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [offeringId]);
        const activeBids = await this.bids.countActiveForOffering(offeringId, manager);
        if (activeBids >= this.cfg.maxBidsPerOffering) {
          throw failHttp(ErrorCode.OFFERING_TOO_MANY_BIDS, HttpStatus.CONFLICT, 'This offering has reached its maximum number of bids');
        }
        const row = await this.bids.insertSubmitted(manager, {
          offeringId,
          collectorSub: userId,
          collectorWallet: resolution.contractAddress,
          priceStroops: dto.price,
          count: String(dto.count),
          idempotencyHash: idemHash,
        });
        if (!row) {
          // Conflict on the active-per-collector OR idem-hash partial-unique index (no thrown 23505).
          throw failHttp(ErrorCode.BID_ALREADY_ACTIVE, HttpStatus.CONFLICT, 'You already have an active bid on this offering');
        }
        await this.audit.record(
          {
            actorType: 'user',
            actorId: userId,
            kind: AUDIT_KIND.BID_SUBMITTED,
            subjectType: 'offering_bid',
            subjectId: row.id,
            payload: {
              offeringId,
              priceStroops: row.priceStroops,
              count: row.count,
              escrowAmountStroops: row.escrowAmountStroops,
            },
          },
          manager,
        );
        return row;
      });

      job = {
        bidId: bid.id,
        walletContract: resolution.contractAddress,
        escrowContract,
        tokenContract: this.relayerCfg.usdcTokenAddress,
        priceScaled: dto.price,
        count: String(dto.count),
        maxCostScaled: this.cfg.maxBidCostStroops,
        idempotencyKey: idemHash.toString('base64url'),
        txXdr: dto.txXdr,
        boundPublicKey: Buffer.from(boundPublicKey).toString('base64url'),
        credentialId: resolution.credential.credentialId,
        authenticatorData: dto.authenticatorData,
        clientDataJSON: dto.clientDataJSON,
        signature: dto.signature,
        rpId: this.webauthn.rpId,
        allowedOrigins: this.webauthn.origins,
      };
    } catch (err) {
      await this.idempotency.fail(key, token);
      throw err;
    }

    // Committed — the two calls below are OUTSIDE the fail-guard, so a post-commit failure (e.g. a Redis
    // blip in complete()) never calls fail() on the key. Both are best-effort; a stranded 'submitted' bid is
    // recoverable via GET /bids/me + manual recovery (todo 294/302).
    const body = BidResponseDto.fromEntity(bid);
    await this.idempotency.complete(key, token, body);
    try {
      await this.escrowQueue.add('escrow', job, {
        jobId: `bid-escrow:${bid.id}:${randomUUID()}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        // The payload holds a passkey assertion (a bearer credential valid only ~120 ledgers). Drop failed
        // jobs quickly (5 min) so it isn't retained in Redis long past its on-chain usefulness (todo 304).
        // The failure reason is already recorded in the BID_ESCROW_FAILED audit row (no assertion bytes).
        removeOnFail: { age: 300 },
      });
    } catch (err) {
      this.logger.warn(`bid escrow enqueue failed [bid=${bid.id}]; requires manual recovery: ${String(err)}`);
    }
    return body;
  }

  /**
   * The caller's LATEST bid on an offering (any status incl. terminal), or null — the async status poll
   * target (TOV-158). Unlike the internal one-active-bid gate (`findMyActiveBid`), this surfaces
   * `canceling → canceled` (+ the refund stamps) and `failed` so the FE can read a terminal outcome.
   */
  async getMyBid(userId: string, offeringId: string): Promise<BidResponseDto | null> {
    const bid = await this.bids.findMyLatestBid(offeringId, userId);
    return bid ? BidResponseDto.fromEntity(bid) : null;
  }

  /**
   * Build the unsigned `cancel_bid` + the passkey challenge for the caller's active escrowed bid (TOV-158).
   * No DB write, no Idempotency-Key (cancel_bid carries no on-chain idem key), no balance pre-check (a refund
   * credits the bidder). NOT whitelist-gated — a de-whitelisted collector must still be able to reclaim funds.
   */
  async prepareCancel(userId: string, offeringId: string): Promise<PrepareCancelBidResponseDto> {
    const { escrowContract, chainBidId, collectorWallet } = await this.assertCancelable(userId, offeringId);
    const resolution = await this.resolveCancelWallet(userId, collectorWallet);

    const built = await this.relayer
      .buildCancelBid({ caller: collectorWallet, escrowContract, bidId: chainBidId })
      .catch((err: unknown) => {
        throw this.mapCancelRelayerError(err);
      });

    return PrepareCancelBidResponseDto.create({
      txXdr: built.txXdr,
      challenge: built.challenge,
      expiresAtLedger: built.expiresAtLedger,
      credentialId: resolution.credential.credentialId,
      transports: resolution.credential.transports,
      rpId: this.webauthn.rpId,
      escrowContract,
      bidId: chainBidId,
    });
  }

  /** CAS the bid `canceling` + enqueue the async refund. Idempotent; returns the canceling bid (202). */
  async cancel(
    userId: string,
    offeringId: string,
    dto: CancelBidDto,
    idempotencyKey: string,
  ): Promise<BidResponseDto> {
    const key = `idem:offering-bid-cancel:${userId}:${offeringId}:${idempotencyKey}`;
    const fingerprint = createHash('sha256')
      .update(`${userId}|${offeringId}|${dto.txXdr}`)
      .digest('hex');

    const begin = await this.idempotency.begin(key, fingerprint);
    if (begin.outcome === 'replay') {
      return begin.body as BidResponseDto;
    }
    if (begin.outcome === 'in_flight') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT, HttpStatus.CONFLICT, 'A cancel with this key is still processing');
    }
    if (begin.outcome === 'mismatch') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_MISMATCH, HttpStatus.UNPROCESSABLE_ENTITY, 'Idempotency-Key reused with a different body');
    }
    const { token } = begin;

    // Fail-guarded region: the CAS + audit. A throw releases the idempotency key so a genuine retry proceeds.
    let bidId: string;
    let body: BidResponseDto;
    let job: OfferingBidCancelJob;
    try {
      const { bid, escrowContract, chainBidId, collectorWallet } = await this.assertCancelable(userId, offeringId);
      const resolution = await this.resolveCancelWallet(userId, collectorWallet);
      const boundPublicKey = this.decodeBoundKey(resolution);
      // Fail fast on a stale signature → BID_CHALLENGE_EXPIRED, before any state change (reuses the
      // fn-agnostic expiry parser; a root-only cancel_bid tx passes its single-op/address-cred checks).
      try {
        await this.relayer.assertBidNotExpired(dto.txXdr);
      } catch (err) {
        throw this.mapCancelRelayerError(err);
      }

      await this.bids.runInTransaction(async (manager) => {
        const won = await this.bids.casCanceling(manager, bid.id);
        if (!won) {
          // Lost the escrowed→canceling CAS (concurrent cancel, or the bid left `escrowed`).
          throw failHttp(ErrorCode.BID_NOT_CANCELABLE, HttpStatus.CONFLICT, 'This bid is no longer cancelable');
        }
        await this.audit.record(
          {
            actorType: 'user',
            actorId: userId,
            kind: AUDIT_KIND.BID_CANCELING,
            subjectType: 'offering_bid',
            subjectId: bid.id,
            payload: { offeringId, chainBidId },
          },
          manager,
        );
      });

      // The CAS won → the row is now `canceling`. Project the already-loaded entity for the 202 body rather
      // than re-reading (no generated column changed here, unlike insertSubmitted); refund stamps are null on
      // the pre-cancel row (todo 316).
      bid.status = 'canceling';
      bidId = bid.id;
      body = BidResponseDto.fromEntity(bid);
      job = {
        bidId: bid.id,
        walletContract: collectorWallet,
        escrowContract,
        chainBidId,
        txXdr: dto.txXdr,
        boundPublicKey: Buffer.from(boundPublicKey).toString('base64url'),
        credentialId: resolution.credential.credentialId,
        authenticatorData: dto.authenticatorData,
        clientDataJSON: dto.clientDataJSON,
        signature: dto.signature,
        rpId: this.webauthn.rpId,
        allowedOrigins: this.webauthn.origins,
      };
    } catch (err) {
      await this.idempotency.fail(key, token);
      throw err;
    }

    // Committed. The compensating revert is scoped to ENQUEUE failure ONLY — the one state where the refund
    // job provably never became live. A lost cancel job would otherwise strand REAL escrowed USDC in
    // `canceling` (replayed 202, slot held), so on an `add` failure we revert canceling→escrowed + release the
    // key so the collector can cleanly re-cancel. Crucially, `complete()` is NOT in this try: once the job is
    // enqueued the worker owns the outcome, and a post-enqueue `complete()` blip must NEVER trigger the revert
    // (reverting a live/landed refund → double-refund / DB-chain drift — the exact move the worker forbids).
    try {
      await this.cancelQueue.add('cancel', job, {
        jobId: `bid-cancel:${bidId}:${randomUUID()}`,
        // Retry window sized to comfortably OUTLAST BID_SIG_VALIDITY_LEDGERS (~120 ledgers ≈ 10 min): a
        // persistently ambiguous cancel eventually re-submits with an expired signature → 'expired'
        // (provably-no-refund) → canceling→escrowed self-heal, so no row stays stuck without a reconciler.
        // 12 attempts (exp backoff 2s) ≈ 68 min of window with ~3 attempts landing PAST the ~10-min expiry, so
        // a single RPC blip on the first post-expiry attempt can't strand the row (todo 312).
        attempts: 12,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        // Keep a failed job's signed assertion around LONGER than the stuck-canceling alert window (10 min)
        // so ops can inspect it; the reason is also in the BID_CANCEL_FAILED audit row (no assertion bytes).
        removeOnFail: { age: 900 },
      });
    } catch (err) {
      // The job never enqueued → safe to revert. Wrap the revert so a DB error can't swallow the 503.
      this.logger.warn(`bid cancel enqueue failed [bid=${bidId}]; reverting to escrowed: ${String(err)}`);
      try {
        await this.bids.runInTransaction((manager) => this.bids.casCancelFailedBackToEscrowed(manager, bidId));
      } catch (revertErr) {
        this.logger.error(`bid cancel revert failed [bid=${bidId}]: ${String(revertErr)}`);
      }
      await this.idempotency.fail(key, token);
      throw failHttp(ErrorCode.BID_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE, 'Could not schedule the refund — please retry');
    }

    // The job is live and authoritative — `complete()` is best-effort and must NEVER revert. On a Redis blip
    // here the key self-expires (or a client retry sees BID_NOT_CANCELABLE since the bid is `canceling`); the
    // enqueued job still drives the row to `canceled` and the client polls GET :id/bids/me for the terminal.
    await this.idempotency
      .complete(key, token, body)
      .catch((err: unknown) => this.logger.warn(`bid cancel idem complete failed [bid=${bidId}]: ${String(err)}`));
    return body;
  }

  // ── shared validation ────────────────────────────────────────────────────────────────────────────

  /**
   * Load + gate the offering (must be `opened`) and the caller's active bid (must be `escrowed` with a
   * `chain_bid_id`). Deliberately NOT whitelist-gated (decision #6). Returns server-trusted routing inputs.
   */
  private async assertCancelable(
    userId: string,
    offeringId: string,
  ): Promise<{ bid: OfferingBid; escrowContract: string; chainBidId: number; collectorWallet: string }> {
    const offering = await this.offerings.findOneById(offeringId);
    if (!offering) {
      throw failHttp(ErrorCode.OFFERING_NOT_FOUND, HttpStatus.NOT_FOUND, 'Offering not found');
    }
    if (offering.status !== OPENED || !offering.escrowContractAddress) {
      throw failHttp(ErrorCode.OFFERING_NOT_OPEN, HttpStatus.CONFLICT, 'Offering is not open — bids can only be canceled while open');
    }
    const bid = await this.bids.findMyActiveBid(offeringId, userId);
    if (!bid) {
      // No existence oracle: a non-owner / no-bid caller gets an identical 404.
      throw failHttp(ErrorCode.BID_NOT_FOUND, HttpStatus.NOT_FOUND, 'No active bid to cancel');
    }
    if (bid.status !== 'escrowed' || bid.chainBidId == null) {
      // In-flight `submitted` (no chain id yet), or already `canceling`/terminal.
      throw failHttp(ErrorCode.BID_NOT_CANCELABLE, HttpStatus.CONFLICT, 'This bid cannot be canceled in its current state');
    }
    return {
      bid,
      escrowContract: offering.escrowContractAddress,
      chainBidId: bid.chainBidId,
      collectorWallet: bid.collectorWallet,
    };
  }

  /** Resolve the caller's embedded wallet + credential, pinned to the bid's recorded `collector_wallet`. */
  private async resolveCancelWallet(userId: string, expectedWallet: string): Promise<WalletResolution> {
    const resolution = await this.resolveWallet(userId);
    if (resolution.contractAddress !== expectedWallet) {
      // The bidding wallet was rotated/replaced (future multi-wallet): the on-chain cancel_bid would revert
      // NotBidOwner. Fail fast rather than strand the escrow behind a doomed tx.
      throw failHttp(ErrorCode.BID_NOT_CANCELABLE, HttpStatus.CONFLICT, 'The bidding wallet is no longer available to cancel');
    }
    return resolution;
  }

  /** Map a terminal relayer error to a cancel-surface HTTP failure (own BID_* codes; opaque for signatures). */
  private mapCancelRelayerError(err: unknown): HttpException {
    return this.mapRelayerErrorTo(err, {
      rejectedCode: ErrorCode.BID_CANCEL_REJECTED,
      rejectedMessage: 'The bid could not be canceled',
      serviceMessage: 'Cancel service temporarily unavailable',
      logLabel: 'relayer cancel call failed',
    });
  }

  /**
   * Shared relayer-error → HTTP mapping for both the bid and cancel surfaces (todo 314). The signature/expiry
   * arms are identical across surfaces; only the on-chain-rejected code/message and the service-unavailable
   * wording differ, so they are parameterized. The single `never` guard means a new `TransferErrorReason` is a
   * compile error in ONE place, not silently 503'd on either surface.
   */
  private mapRelayerErrorTo(
    err: unknown,
    opts: { rejectedCode: ErrorCode; rejectedMessage: string; serviceMessage: string; logLabel: string },
  ): HttpException {
    if (err instanceof RelayerTransferError) {
      switch (err.reason) {
        case 'signature_required':
          return failHttp(ErrorCode.BID_SIGNATURE_REQUIRED, HttpStatus.UNPROCESSABLE_ENTITY, 'Passkey signature required');
        case 'signature_invalid':
          return failHttp(ErrorCode.BID_SIGNATURE_INVALID, HttpStatus.UNPROCESSABLE_ENTITY, 'Passkey signature is invalid');
        case 'expired':
          return failHttp(ErrorCode.BID_CHALLENGE_EXPIRED, HttpStatus.UNPROCESSABLE_ENTITY, 'Signing timed out — please try again');
        case 'simulation_failed':
        case 'transfer_failed':
          return failHttp(opts.rejectedCode, HttpStatus.UNPROCESSABLE_ENTITY, opts.rejectedMessage);
        case 'unavailable':
          return failHttp(ErrorCode.BID_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE, opts.serviceMessage);
        default: {
          const _exhaustive: never = err.reason;
          void _exhaustive;
          return failHttp(ErrorCode.BID_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE, opts.serviceMessage);
        }
      }
    }
    this.logger.warn(`${opts.logLabel}: ${String(err)}`);
    return failHttp(ErrorCode.BID_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE, opts.serviceMessage);
  }

  /** Load + gate the offering (status/window/band/float), the whitelist, and the one-active-bid rule. */
  private async assertBiddable(
    userId: string,
    offeringId: string,
    dto: PrepareBidDto,
  ): Promise<{ offering: Offering; escrowContract: string; escrowStroops: string }> {
    const offering = await this.offerings.findOneById(offeringId);
    if (!offering) {
      throw failHttp(ErrorCode.OFFERING_NOT_FOUND, HttpStatus.NOT_FOUND, 'Offering not found');
    }
    if (offering.status !== OPENED || !offering.escrowContractAddress) {
      throw failHttp(ErrorCode.OFFERING_NOT_OPEN, HttpStatus.CONFLICT, 'Offering is not open for bids');
    }
    const now = Date.now();
    if (now < offering.windowOpenAt.getTime()) {
      throw failHttp(ErrorCode.OFFERING_WINDOW_NOT_OPEN, HttpStatus.UNPROCESSABLE_ENTITY, 'The subscription window has not opened yet');
    }
    if (now >= offering.windowCloseAt.getTime()) {
      throw failHttp(ErrorCode.OFFERING_WINDOW_CLOSED, HttpStatus.UNPROCESSABLE_ENTITY, 'The subscription window has closed');
    }

    const price = BigInt(dto.price);
    if (price < BigInt(offering.lowPriceStroops)) {
      throw failHttp(ErrorCode.BID_BELOW_LOW_PRICE, HttpStatus.UNPROCESSABLE_ENTITY, 'Bid price is below the band');
    }
    if (price > BigInt(offering.highPriceStroops)) {
      throw failHttp(ErrorCode.BID_ABOVE_HIGH_PRICE, HttpStatus.UNPROCESSABLE_ENTITY, 'Bid price is above the band');
    }
    if (BigInt(dto.count) > BigInt(offering.publicFloat)) {
      throw failHttp(ErrorCode.BID_COUNT_EXCEEDS_FLOAT, HttpStatus.UNPROCESSABLE_ENTITY, 'Bid count exceeds the offering float');
    }
    // TOV-160: the on-chain close_and_settle refunds EVERY active bid in one atomic tx, so the book has a
    // hard size ceiling (~tens). Reject a new bid once the offering is at capacity — by settle time it is too
    // late to shed a bid without a refund. This is the FAST-FAIL pre-check (avoids building/signing a tx that
    // the atomic guard would reject); the AUTHORITATIVE, race-free enforcement is the per-offering advisory
    // lock + count in submit()'s insert transaction (#319).
    const activeBids = await this.bids.countActiveForOffering(offeringId);
    if (activeBids >= this.cfg.maxBidsPerOffering) {
      throw failHttp(ErrorCode.OFFERING_TOO_MANY_BIDS, HttpStatus.CONFLICT, 'This offering has reached its maximum number of bids');
    }

    // Whitelist gate (identity-level KYC; the on-chain allowlist inside usdc.transfer is authoritative).
    const user = await this.users.findKycStatusByUserId(userId);
    if (!user || user.kycStatus !== KycStatus.WHITELISTED) {
      throw failHttp(ErrorCode.BID_NOT_WHITELISTED, HttpStatus.FORBIDDEN, 'Complete KYC to bid');
    }

    let escrowStroops: string;
    try {
      escrowStroops = computeEscrowStroops(dto.price, String(dto.count));
    } catch {
      throw failHttp(ErrorCode.BID_COST_EXCEEDS_LIMIT, HttpStatus.UNPROCESSABLE_ENTITY, 'Bid amount is out of range');
    }
    if (BigInt(escrowStroops) > BigInt(this.cfg.maxBidCostStroops)) {
      throw failHttp(ErrorCode.BID_COST_EXCEEDS_LIMIT, HttpStatus.UNPROCESSABLE_ENTITY, 'Bid amount exceeds the per-bid ceiling');
    }
    // escrowContractAddress is non-null here (guarded above), so the proven value travels with the result —
    // callers never re-cast `as string` on a money-routing field (todo 305).
    return { offering, escrowContract: offering.escrowContractAddress, escrowStroops };
  }

  private async resolveWallet(userId: string): Promise<WalletResolution> {
    try {
      return await this.walletsService.resolveEmbeddedWalletForUser(userId);
    } catch (err) {
      if (err instanceof EmbeddedWalletNotFoundError) {
        throw failHttp(ErrorCode.WALLET_NOT_FOUND, HttpStatus.NOT_FOUND, 'No embedded wallet for the caller');
      }
      throw err;
    }
  }

  private decodeBoundKey(resolution: WalletResolution): Uint8Array {
    try {
      return decodeCoseToRawP256(Uint8Array.from(resolution.credential.publicKey));
    } catch {
      throw failHttp(ErrorCode.BID_SIGNATURE_INVALID, HttpStatus.UNPROCESSABLE_ENTITY, 'Bound passkey credential is malformed');
    }
  }

  /** Best-effort USDC balance pre-check → 422 BID_INSUFFICIENT_BALANCE (with amounts) before the passkey prompt. */
  private async assertSufficientBalance(walletContract: string, escrowStroops: string): Promise<void> {
    let available: string;
    try {
      const holdings = await this.relayer.readWalletHoldings({
        walletContract,
        tokenContracts: [this.relayerCfg.usdcTokenAddress],
      });
      available = holdings[0]?.amountScaled ?? '0';
    } catch (err) {
      // A balance-read failure must not create a bid; surface it as unavailable (fail-closed).
      throw this.mapRelayerError(err);
    }
    if (BigInt(available) < BigInt(escrowStroops)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          error: 'Unprocessable Entity',
          message: 'Insufficient USDC balance for this bid',
          errorCode: ErrorCode.BID_INSUFFICIENT_BALANCE,
          requiredStroops: escrowStroops,
          availableStroops: available,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  /** Map a terminal relayer error to a bid-surface HTTP failure (own BID_* codes; opaque for signatures). */
  private mapRelayerError(err: unknown): HttpException {
    return this.mapRelayerErrorTo(err, {
      rejectedCode: ErrorCode.BID_ESCROW_REJECTED,
      rejectedMessage: 'The bid could not be escrowed',
      serviceMessage: 'Bid service temporarily unavailable',
      logLabel: 'relayer bid call failed',
    });
  }
}
