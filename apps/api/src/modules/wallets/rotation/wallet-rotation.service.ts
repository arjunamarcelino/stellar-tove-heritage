import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { webauthnConfig } from '@config/webauthn.config';
import { ErrorCode } from '@common/enums/error-code.enum';
import { failHttp } from '@common/http/fail-http';
import { assertNever } from '@common/utils/assert-never';
import { isUniqueConstraintError } from '@common/utils/database.utils';
import { RELAYER_SERVICE, IRelayerService } from '@modules/relayer/relayer.service.interface';
import { RelayerTransferError } from '@modules/relayer/relayer.errors';
import { mapRelayerTransferError, transferErrorMapping } from '@modules/relayer/transfer-error-http';
import {
  FRACTION_READ_SERVICE,
  IFractionReadService,
} from '@modules/fractionalization/fraction-read.service.interface';
import { FractionReadUnavailableError } from '@modules/fractionalization/fraction-read.errors';
import {
  FRACTION_CONTRACT_REPOSITORY,
  IFractionContractRepository,
} from '@modules/fractionalization/repositories/fraction-contract-repository.interface';
import { FractionContract } from '@modules/fractionalization/entities/fraction-contract.entity';
import {
  KYC_ALLOWLIST_TX_SERVICE,
  IKycAllowlistTxService,
} from '@modules/kyc-allowlist/kyc-allowlist-tx.service.interface';
import { WalletsService } from '../wallets.service';
import { Wallet } from '../entities/wallet.entity';
import { PasskeyCredential } from '../entities/passkey-credential.entity';
import { decodeCoseToRawP256 } from '../cose.helper';
import { AuditLogService } from '../audit/audit-log.service';
import { AUDIT_KIND, AuditKind } from '../audit/audit-log.types';
import { WalletExport } from '../export/entities/wallet-export.entity';
import {
  WALLET_ROTATION_REPOSITORY,
  IWalletRotationRepository,
} from './repositories/wallet-rotation-repository.interface';
import {
  REGISTRY_EVENT_REPOSITORY,
  IRegistryEventRepository,
  RegistryEventInsert,
} from './repositories/registry-event-repository.interface';
import { WalletRotationTransfer } from './entities/wallet-rotation-transfer.entity';
import { WalletRotationTransferItem } from './entities/wallet-rotation-transfer-item.entity';
import { WalletRotationStatus } from './rotation-status.types';
import { WalletRotationError, WalletRotationReason } from './wallet-rotation.error';
import { RotateTransferDto } from './dto/rotate-transfer.dto';
import { RotateTransferItemDto, RotateTransferResponseDto } from './dto/rotate-transfer-response.dto';
import { SubmitRotateTransferDto } from './dto/submit-rotate-transfer.dto';
import {
  SubmitRotateTransferItemResultDto,
  SubmitRotateTransferResponseDto,
} from './dto/submit-rotate-transfer-response.dto';
import {
  CancelRotateTransferResponseDto,
  RotationReadState,
  RotateTransferStatusResponseDto,
} from './dto/rotate-transfer-status-response.dto';

const ROTATION_FAIL_MESSAGE = 'Wallet rotation request failed';

/** Reason → (ErrorCode, HttpStatus). Total over `WalletRotationReason` (exhaustive by construction). */
const ROTATION_ERROR_MAP: Record<WalletRotationReason, [ErrorCode, HttpStatus]> = {
  not_found: [ErrorCode.WALLET_NOT_FOUND, HttpStatus.NOT_FOUND],
  source_invalid: [ErrorCode.ROTATION_SOURCE_INVALID, HttpStatus.UNPROCESSABLE_ENTITY],
  source_already_exported: [ErrorCode.ALREADY_EXPORTED, HttpStatus.CONFLICT],
  destination_invalid: [ErrorCode.ROTATION_DESTINATION_INVALID, HttpStatus.UNPROCESSABLE_ENTITY],
  destination_not_primary: [ErrorCode.ROTATION_DESTINATION_NOT_PRIMARY, HttpStatus.CONFLICT],
  conflict: [ErrorCode.ROTATION_CONFLICT, HttpStatus.CONFLICT],
  nothing_to_transfer: [ErrorCode.ROTATION_NOTHING_TO_TRANSFER, HttpStatus.UNPROCESSABLE_ENTITY],
  blocked_by_lockup: [ErrorCode.ROTATION_BLOCKED_BY_LOCKUP, HttpStatus.UNPROCESSABLE_ENTITY],
  recipient_not_whitelisted: [ErrorCode.RECIPIENT_NOT_WHITELISTED, HttpStatus.UNPROCESSABLE_ENTITY],
  rotation_not_found: [ErrorCode.ROTATION_NOT_FOUND, HttpStatus.NOT_FOUND],
  cannot_cancel: [ErrorCode.ROTATION_CANNOT_CANCEL, HttpStatus.CONFLICT],
  read_unavailable: [ErrorCode.HOLDINGS_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE],
};

/** Map the parent rotation status to the FE reconciliation state. Exhaustive (assertNever). */
function mapRotationStateForRead(status: WalletRotationStatus): RotationReadState {
  switch (status) {
    case 'completed':
      return 'confirmed';
    case 'failed':
      return 'failed';
    case 'submitting':
      return 'submitting';
    case 'pending':
      return 'pending';
    default:
      return assertNever(status);
  }
}

/**
 * Orchestrates the wallet-rotation holdings transfer (TOV-33): move ALL of a Collector's FractionToken
 * balances from their embedded passkey wallet (source) to their own BYOW settlement wallet (destination) as
 * N single-op Soroban transfers. Copy-adapted from the TOV-40 export drain — same two-phase, stateful,
 * resumable, per-item money-safety spine (verify-against-stored-XDR, exact-amount + recipient pin, per-item
 * CAS, serialized send-lock, no-DB-txn-across-send, row-locked completion latch + live-balance-zero gate,
 * status-read reconcile) — with rotation's forks: enumerate the fraction registry (not config); destination
 * is an owned BYOW primary (gated by the on-chain KYC allowlist); a `custody_transfer` registry row is
 * written atomically with each confirm; the write-safe lockup gate refuses locked artist retention; and the
 * source is NEVER latched `exported` (rotation only moves holdings — removal is the separate DELETE).
 */
@Injectable()
export class WalletRotationService {
  private readonly logger = new Logger(WalletRotationService.name);

  constructor(
    @Inject(webauthnConfig.KEY) private readonly webauthn: ConfigType<typeof webauthnConfig>,
    @Inject(RELAYER_SERVICE) private readonly relayer: IRelayerService,
    @Inject(WALLET_ROTATION_REPOSITORY) private readonly rotationRepo: IWalletRotationRepository,
    @Inject(REGISTRY_EVENT_REPOSITORY) private readonly registry: IRegistryEventRepository,
    @Inject(FRACTION_READ_SERVICE) private readonly fractionRead: IFractionReadService,
    @Inject(FRACTION_CONTRACT_REPOSITORY) private readonly fractionContracts: IFractionContractRepository,
    @Inject(KYC_ALLOWLIST_TX_SERVICE) private readonly allowlist: IKycAllowlistTxService,
    @InjectRepository(WalletExport) private readonly exportsRepo: Repository<WalletExport>,
    private readonly walletsService: WalletsService,
    private readonly audit: AuditLogService,
  ) {}

  /** Initiate or resume a rotation: validate, gate, snapshot source holdings, and return builds to sign. */
  async initiate(userId: string, sourceWalletId: string, dto: RotateTransferDto): Promise<RotateTransferResponseDto> {
    try {
      const { credential, contract: sourceContract } = await this.resolveSourceWallet(userId, sourceWalletId);
      const { wallet: dest, address: destinationAddress } = await this.resolveDestinationWallet(
        userId,
        dto.destinationWalletId,
        sourceWalletId,
      );

      // Cross-feature guard: refuse if an ACTIVE export is in flight on the source (both would drain the same
      // balance to different destinations). Scoped to genuinely-active states (`pending`/`submitting`) so a
      // terminally-`failed` export doesn't wedge rotation forever (todo 431). Rotation's own unique index
      // blocks a 2nd rotation; the reverse guard (active rotation blocks a new export) lives in WalletExportService.
      const activeExport = await this.exportsRepo.findOne({
        where: { walletId: sourceWalletId, status: In(['pending', 'submitting']) },
      });
      if (activeExport) throw new WalletRotationError('conflict');

      // Enumerate the source's non-zero fraction balances — read the SOURCE contract explicitly (NEVER the
      // primary resolver, which after set-primary points at the empty destination). Universe = the deployed
      // fraction registry (bounded read), so no held token is silently omitted.
      const deployed = await this.fractionContracts.findAllDeployed();
      const contractByToken = new Map<string, FractionContract>();
      for (const c of deployed) if (c.tokenAddress) contractByToken.set(c.tokenAddress, c);
      const tokenContracts = [...contractByToken.keys()];
      const balances = await this.readBalances(tokenContracts, sourceContract);
      const nonZero = [...balances.entries()]
        .filter(([, amount]) => this.isPositive(amount))
        .map(([tokenContract, amountScaled]) => ({ tokenContract, amountScaled }));
      if (nonZero.length === 0) throw new WalletRotationError('nothing_to_transfer');

      // Write-safe lockup gate: rotation moves the FULL balance, so an artist position still within lockup
      // (retention floor > 0) is refused wholesale. Chain enforces the exact floor as the hard backstop.
      // The 422 carries `lockupExpiresAt` (ISO-8601, the LATEST blocking position's on-chain unlock — rotation
      // is possible once every locked position clears) so the FE can compose the review-step copy (TOV-48 AC).
      const nowSeconds = this.nowSeconds();
      let lockupUntil: bigint | null = null;
      for (const holding of nonZero) {
        const c = contractByToken.get(holding.tokenContract);
        if (c && this.isArtistPositionLocked(c, sourceContract, nowSeconds)) {
          const until = BigInt(c.artistLockupUntil as string); // non-null guaranteed by isArtistPositionLocked
          if (lockupUntil === null || until > lockupUntil) lockupUntil = until;
        }
      }
      if (lockupUntil !== null) throw this.failLockup(lockupUntil);

      // Destination allowlist pre-flight (authoritative on-chain is_allowed; TOV-243 makes G-addresses
      // encodable). The FractionToken hard-gates recipients, so this is a fail-fast pre-check + chain backstop.
      await this.ensureAllowlisted(destinationAddress);

      // Find-or-create the single active rotation; destination frozen at first initiate.
      let rotation = await this.rotationRepo.findActiveBySourceWithItems(sourceWalletId);
      if (rotation && rotation.destinationAddress !== destinationAddress) {
        throw new WalletRotationError('conflict');
      }
      if (!rotation) {
        try {
          rotation = await this.rotationRepo.createRotation(sourceWalletId, userId, dest.id, destinationAddress);
        } catch (err) {
          if (!isUniqueConstraintError(err)) throw err;
          rotation = await this.rotationRepo.findActiveBySourceWithItems(sourceWalletId);
          if (!rotation) throw new WalletRotationError('conflict');
        }
      }

      // Build a transfer per still-pending holding; confirmed items are never rebuilt/re-transferred.
      const existingByToken = new Map((rotation.items ?? []).map((i) => [i.tokenContract, i]));
      const items: RotateTransferItemDto[] = [];
      for (const holding of nonZero) {
        const existing = existingByToken.get(holding.tokenContract);
        if (existing?.status === 'confirmed') continue;
        let built: Awaited<ReturnType<IRelayerService['buildTransfer']>>;
        try {
          built = await this.relayer.buildTransfer({
            walletContract: sourceContract,
            tokenContract: holding.tokenContract,
            to: destinationAddress,
            amountScaled: holding.amountScaled,
          });
        } catch (err) {
          throw this.mapRelayerError(err);
        }
        const item = await this.rotationRepo.upsertItemBuild({
          existingId: existing?.id,
          rotationId: rotation.id,
          tokenContract: holding.tokenContract,
          amountScaled: holding.amountScaled,
          unsignedTxXdr: built.txXdr,
          expiresAtLedger: built.expiresAtLedger,
        });
        items.push({
          itemId: item.id,
          tokenContract: item.tokenContract,
          amountScaled: item.amountScaled,
          challenge: built.challenge,
          expiresAtLedger: built.expiresAtLedger,
        });
      }

      await this.audit.record({
        actorType: 'user',
        actorId: userId,
        kind: AUDIT_KIND.ROTATION_REQUESTED,
        subjectType: 'wallet_rotation_transfer',
        subjectId: rotation.id,
        payload: { sourceWalletId, destinationWalletId: dest.id, itemCount: items.length },
      });

      return RotateTransferResponseDto.create({
        rotationId: rotation.id,
        sourceWalletId,
        destinationWalletId: dest.id,
        credentialId: credential.credentialId,
        transports: credential.transports,
        rpId: this.webauthn.rpId,
        items,
      });
    } catch (err) {
      throw this.rethrow(err);
    }
  }

  /** Submit signed assertions; confirm each item + write its custody_transfer row; complete when all confirm. */
  async submit(
    userId: string,
    sourceWalletId: string,
    dto: SubmitRotateTransferDto,
  ): Promise<SubmitRotateTransferResponseDto> {
    try {
      const { credential, contract: sourceContract } = await this.resolveSourceWallet(userId, sourceWalletId);

      const rotation = await this.rotationRepo.findOwnedWithItems(dto.rotationId, sourceWalletId, userId);
      if (!rotation) throw new WalletRotationError('rotation_not_found');
      // Re-validate the destination allowlist at the moment of money movement (a revocation must block).
      await this.ensureAllowlisted(rotation.destinationAddress);

      let boundPublicKey: Uint8Array;
      try {
        boundPublicKey = decodeCoseToRawP256(Uint8Array.from(credential.publicKey));
      } catch {
        throw this.fail(ErrorCode.TRANSFER_SIGNATURE_INVALID, HttpStatus.UNPROCESSABLE_ENTITY);
      }

      const itemById = new Map(rotation.items.map((i) => [i.id, i]));
      const results: SubmitRotateTransferItemResultDto[] = [];
      for (const submitted of dto.items) {
        const item = itemById.get(submitted.itemId);
        if (!item) {
          results.push({ itemId: submitted.itemId, status: 'failed', errorCode: ErrorCode.ROTATION_NOT_FOUND });
          continue;
        }
        if (item.status === 'confirmed') {
          results.push({
            itemId: item.id,
            status: 'confirmed',
            txHash: item.txHash ?? undefined,
            ledger: item.ledger ?? undefined,
          });
          continue;
        }
        if (!item.unsignedTxXdr) {
          results.push({ itemId: item.id, status: 'failed', errorCode: ErrorCode.TRANSFER_EXPIRED });
          continue;
        }
        // Single-writer per item: claim pending/failed -> submitted; a lost CAS is in-flight, never re-sent.
        if (!(await this.rotationRepo.claimItemForSubmit(item.id))) {
          results.push({ itemId: item.id, status: 'submitted' });
          continue;
        }
        // Per-item allowlist re-check (the drain can span many seconds; a mid-loop revocation blocks the rest).
        // The item is ALREADY claimed (`submitted`); the on-chain `is_allowed` read can THROW on an RPC blip, so
        // it must be handled here rather than propagated — a bare throw would strand the claimed item `submitted`
        // with a non-zero balance (never sent, un-reconcilable, un-cancelable) → a permanently wedged rotation
        // (todo 429). On a read failure, fail the item RECOVERABLY (re-buildable on the next initiate).
        let recipientAllowed: boolean;
        try {
          recipientAllowed = await this.allowlist.isAllowed(rotation.destinationAddress);
        } catch (err) {
          this.logger.warn(`allowlist re-check failed mid-submit [item=${item.id}]: ${String(err)}`);
          await this.rotationRepo.markItemFailed(item.id, ErrorCode.TRANSFER_UNAVAILABLE);
          item.status = 'failed';
          await this.auditItem(AUDIT_KIND.ROTATION_FAILED, userId, rotation.id, item, {
            errorCode: ErrorCode.TRANSFER_UNAVAILABLE,
          });
          results.push({ itemId: item.id, status: 'failed', errorCode: ErrorCode.TRANSFER_UNAVAILABLE });
          continue;
        }
        if (!recipientAllowed) {
          await this.rotationRepo.markItemFailed(item.id, ErrorCode.RECIPIENT_NOT_WHITELISTED);
          item.status = 'failed';
          await this.auditItem(AUDIT_KIND.ROTATION_FAILED, userId, rotation.id, item, {
            errorCode: ErrorCode.RECIPIENT_NOT_WHITELISTED,
          });
          results.push({ itemId: item.id, status: 'failed', errorCode: ErrorCode.RECIPIENT_NOT_WHITELISTED });
          continue;
        }
        try {
          const res = await this.relayer.submitSignedTransfer({
            txXdr: item.unsignedTxXdr, // the STORED tx — never the client body
            walletContract: sourceContract,
            tokenContract: item.tokenContract,
            boundPublicKey,
            credentialId: credential.credentialId,
            authenticatorData: Buffer.from(submitted.authenticatorData, 'base64url'),
            clientDataJSON: Buffer.from(submitted.clientDataJSON, 'base64url'),
            signature: Buffer.from(submitted.signature, 'base64url'),
            rpId: this.webauthn.rpId,
            allowedOrigins: this.webauthn.origins,
            maxTransferAmount: item.amountScaled, // cap = the frozen snapshot balance
            expectedTo: rotation.destinationAddress,
            expectedAmountScaled: item.amountScaled,
          });
          // Confirm + write the custody_transfer provenance row in ONE transaction (idempotent).
          await this.rotationRepo.markItemConfirmed(item.id, res.txHash, res.ledger, (manager) =>
            this.registry.recordCustodyTransfer(
              this.custodyEntry(rotation, sourceContract, item, res.txHash, res.ledger),
              manager,
            ),
          );
          item.status = 'confirmed';
          item.txHash = res.txHash;
          item.ledger = res.ledger;
          await this.auditItem(AUDIT_KIND.ROTATION_CONFIRMED, userId, rotation.id, item, {
            amountScaled: item.amountScaled,
            txHash: res.txHash,
            ledger: res.ledger,
          });
          results.push({ itemId: item.id, status: 'confirmed', txHash: res.txHash, ledger: res.ledger });
        } catch (err) {
          const errorCode =
            err instanceof RelayerTransferError
              ? transferErrorMapping(err.reason)[0]
              : ErrorCode.TRANSFER_UNAVAILABLE;
          await this.rotationRepo.markItemFailed(item.id, errorCode);
          item.status = 'failed';
          await this.auditItem(AUDIT_KIND.ROTATION_FAILED, userId, rotation.id, item, { errorCode });
          results.push({ itemId: item.id, status: 'failed', errorCode });
        }
      }

      // Completion: every item confirmed AND a live re-read of the frozen fraction set is zero → complete
      // (in a row-locked tx that re-counts against the DB). Rotation never latches the source `exported`.
      const allConfirmed = rotation.items.length > 0 && rotation.items.every((i) => i.status === 'confirmed');
      let allZero = false;
      if (allConfirmed) {
        try {
          const balances = await this.fractionRead.balancesOf(
            rotation.items.map((i) => i.tokenContract),
            sourceContract,
          );
          allZero = [...balances.values()].every((amount) => !this.isPositive(amount));
        } catch {
          allZero = false; // a failed re-read must not complete the rotation
        }
      }
      const completed = await this.rotationRepo.finalizeIfAllConfirmed(
        rotation.id,
        sourceWalletId,
        allZero,
        (manager) =>
          this.audit.record(
            {
              actorType: 'user',
              actorId: userId,
              kind: AUDIT_KIND.ROTATION_COMPLETED,
              subjectType: 'wallet_rotation_transfer',
              subjectId: rotation.id,
              payload: { destinationWalletId: rotation.destinationWalletId },
            },
            manager,
          ),
      );

      const status: WalletRotationStatus = completed ? 'completed' : 'submitting';
      return SubmitRotateTransferResponseDto.create({ rotationId: rotation.id, status, items: results });
    } catch (err) {
      throw this.rethrow(err);
    }
  }

  /** Reconciliation read for the FE — explicit pending/submitting so it never blind-resubmits. */
  async status(userId: string, sourceWalletId: string): Promise<RotateTransferStatusResponseDto> {
    try {
      const wallet = await this.walletsService.findOwnedWallet(userId, sourceWalletId);
      if (!wallet) throw new WalletRotationError('not_found');

      let rotation = await this.rotationRepo.findLatestBySourceWithItems(sourceWalletId);
      if (!rotation) {
        return RotateTransferStatusResponseDto.create({ rotationId: null, state: 'none', items: [] });
      }
      // Lazy crash-recovery: reconcile any item stuck `submitted` or a false-negative `failed` (the tx
      // landed but the DB confirm/mark was lost) using the live balance; re-load to reflect any completion.
      if (wallet.contractAddress && rotation.items.some((i) => i.status === 'submitted' || i.status === 'failed')) {
        await this.reconcileStuckItems(userId, wallet.contractAddress, sourceWalletId, rotation);
        rotation = (await this.rotationRepo.findLatestBySourceWithItems(sourceWalletId)) ?? rotation;
      }
      return RotateTransferStatusResponseDto.create({
        rotationId: rotation.id,
        state: mapRotationStateForRead(rotation.status),
        destinationAddress: rotation.destinationAddress,
        destinationWalletId: rotation.destinationWalletId,
        items: rotation.items.map((i) => ({
          tokenContract: i.tokenContract,
          status: i.status,
          txHash: i.txHash ?? undefined,
        })),
      });
    } catch (err) {
      throw this.rethrow(err);
    }
  }

  /** Cancel an active rotation (clears the one-active latch) — only when no item is in-flight/confirmed. */
  async cancel(userId: string, sourceWalletId: string): Promise<CancelRotateTransferResponseDto> {
    try {
      // Owner-scope the source wallet (404 no-oracle before revealing rotation state).
      const wallet = await this.walletsService.findOwnedWallet(userId, sourceWalletId);
      if (!wallet) throw new WalletRotationError('not_found');

      const rotation = await this.rotationRepo.findActiveBySourceWithItems(sourceWalletId);
      if (!rotation || rotation.userId !== userId) throw new WalletRotationError('rotation_not_found');
      // Money already moved (or in-flight) cannot be un-rotated here — let it finish / reconcile.
      if (rotation.items.some((i) => i.status === 'submitted' || i.status === 'confirmed')) {
        throw new WalletRotationError('cannot_cancel');
      }

      await this.rotationRepo.softCancel(rotation.id);
      await this.audit.record({
        actorType: 'user',
        actorId: userId,
        kind: AUDIT_KIND.ROTATION_CANCELED,
        subjectType: 'wallet_rotation_transfer',
        subjectId: rotation.id,
        payload: { sourceWalletId },
      });
      return CancelRotateTransferResponseDto.create({ canceledId: rotation.id });
    } catch (err) {
      throw this.rethrow(err);
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /** Owner-scoped source resolution: must be an OWNED, active, embedded passkey wallet with a credential. */
  private async resolveSourceWallet(
    userId: string,
    walletId: string,
  ): Promise<{ wallet: Wallet; credential: PasskeyCredential; contract: string }> {
    const wallet = await this.walletsService.findOwnedWallet(userId, walletId);
    if (!wallet) throw new WalletRotationError('not_found');
    if (wallet.kind !== 'embedded_passkey' || !wallet.contractAddress) {
      throw new WalletRotationError('source_invalid');
    }
    if (wallet.status === 'exported') throw new WalletRotationError('source_already_exported');
    const credential = await this.walletsService.getWalletCredential(wallet.id);
    if (!credential) {
      this.logger.warn(`embedded wallet has no bound credential [wallet=${wallet.id}]`);
      throw new WalletRotationError('not_found');
    }
    return { wallet, credential, contract: wallet.contractAddress };
  }

  /** Owner-scoped destination resolution: OWNED BYOW wallet, distinct from the source, current primary. */
  private async resolveDestinationWallet(
    userId: string,
    walletId: string,
    sourceWalletId: string,
  ): Promise<{ wallet: Wallet; address: string }> {
    const wallet = await this.walletsService.findOwnedWallet(userId, walletId);
    if (!wallet) throw new WalletRotationError('not_found');
    if (wallet.id === sourceWalletId || wallet.kind !== 'byow' || !wallet.publicKey) {
      throw new WalletRotationError('destination_invalid');
    }
    if (!wallet.isPrimary) throw new WalletRotationError('destination_not_primary');
    return { wallet, address: wallet.publicKey };
  }

  /**
   * True iff the source holds a still-locked artist retention position on this contract (write-safe gate).
   *
   * INTENDED SCOPE (todo 433, product-confirmed): the FractionToken lockup floor binds only the artist's
   * retained position, and this pre-check fires ONLY when the source embedded-wallet C-address IS the contract's
   * snapshotted `artist_address` — i.e. an artist rotating away from an embedded wallet that holds their
   * retention. Collectors are never lock-floored (a purchased position has no floor), so they are correctly
   * never blocked. When an artist's retention lives at a DIFFERENT address (e.g. a BYOW G-address settlement
   * wallet), this pre-check is intentionally inert and the on-chain FractionToken `check_lockup_floor` is the
   * sole (hard) enforcement — a mis-allow then fails at submit re-simulation, never moving locked funds. The
   * collector/artist unit cases in `wallet-rotation.service.spec.ts` encode this invariant.
   */
  private isArtistPositionLocked(c: FractionContract, sourceContract: string, nowSeconds: number): boolean {
    if (c.artistAddress !== sourceContract) return false; // only the artist's retained position is ever locked
    if (c.artistLockupUntil === null) return false; // legacy/self-heal → not subject (chain is the backstop)
    if (BigInt(nowSeconds) >= BigInt(c.artistLockupUntil)) return false; // lockup elapsed
    return BigInt(c.artistRetentionAmount ?? '0') > 0n; // a full-balance drain violates a non-zero floor
  }

  private async ensureAllowlisted(address: string): Promise<void> {
    if (!(await this.isAllowlisted(address))) throw new WalletRotationError('recipient_not_whitelisted');
  }

  /** On-chain `is_allowed(address)`. A read/encoder failure is treated as unavailable (fail-closed). */
  private async isAllowlisted(address: string): Promise<boolean> {
    try {
      return await this.allowlist.isAllowed(address);
    } catch (err) {
      this.logger.warn(`allowlist read failed [address=${address}]: ${String(err)}`);
      throw new WalletRotationError('read_unavailable');
    }
  }

  /**
   * Crash-recovery: for items stuck `submitted` (send succeeded, DB confirm lost) or falsely `failed` (the tx
   * landed but the relayer errored after send), a drained (zero) balance proves the transfer landed → confirm
   * it + write the custody row. If that completes the rotation, finalize under the same row-locked gate.
   */
  private async reconcileStuckItems(
    userId: string,
    sourceContract: string,
    sourceWalletId: string,
    rotation: WalletRotationTransfer,
  ): Promise<void> {
    const stuck = rotation.items.filter((i) => i.status === 'submitted' || i.status === 'failed');
    if (stuck.length === 0) return;
    let balances: Map<string, string>;
    try {
      balances = await this.fractionRead.balancesOf(
        stuck.map((i) => i.tokenContract),
        sourceContract,
      );
    } catch {
      return; // leave stuck items for the next reconciliation poll
    }
    for (const item of stuck) {
      if (this.isPositive(balances.get(item.tokenContract) ?? '0')) continue;
      this.logger.warn(`reconciling crash-stuck rotation item to confirmed [item=${item.id}]`);
      const confirmed = await this.rotationRepo.reconcileItemConfirmed(item.id, (manager) =>
        this.registry.recordCustodyTransfer(
          this.custodyEntry(rotation, sourceContract, item, item.txHash, item.ledger),
          manager,
        ),
      );
      if (confirmed) item.status = 'confirmed';
    }
    if (rotation.items.length > 0 && rotation.items.every((i) => i.status === 'confirmed')) {
      await this.rotationRepo.finalizeIfAllConfirmed(rotation.id, sourceWalletId, true, (manager) =>
        this.audit.record(
          {
            actorType: 'system',
            actorId: null,
            kind: AUDIT_KIND.ROTATION_COMPLETED,
            subjectType: 'wallet_rotation_transfer',
            subjectId: rotation.id,
            payload: { destinationWalletId: rotation.destinationWalletId, reconciled: true },
          },
          manager,
        ),
      );
    }
  }

  /** Build the append-only custody_transfer provenance row for one confirmed item. */
  private custodyEntry(
    rotation: WalletRotationTransfer,
    sourceContract: string,
    item: WalletRotationTransferItem,
    txHash: string | null,
    ledger: number | null,
  ): RegistryEventInsert {
    return {
      userId: rotation.userId,
      sourceWalletId: rotation.sourceWalletId,
      destinationWalletId: rotation.destinationWalletId,
      fromAddress: sourceContract,
      toAddress: rotation.destinationAddress,
      tokenContract: item.tokenContract,
      amountScaled: item.amountScaled,
      txHash,
      ledger,
      sourceRef: `rotation_item:${item.id}`,
    };
  }

  /** Best-effort per-item audit row (subject = the rotation item), non-transactional (item already persisted). */
  private async auditItem(
    kind: AuditKind,
    userId: string,
    rotationId: string,
    item: WalletRotationTransferItem,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      actorType: 'user',
      actorId: userId,
      kind,
      subjectType: 'wallet_rotation_transfer_item',
      subjectId: item.id,
      payload: { rotation: rotationId, tokenContract: item.tokenContract, ...payload },
    });
  }

  private async readBalances(tokenContracts: string[], walletContract: string): Promise<Map<string, string>> {
    try {
      return await this.fractionRead.balancesOf(tokenContracts, walletContract);
    } catch (err) {
      if (err instanceof FractionReadUnavailableError) throw new WalletRotationError('read_unavailable');
      throw err;
    }
  }

  private isPositive(amountScaled: string): boolean {
    try {
      return BigInt(amountScaled) > 0n;
    } catch {
      return false;
    }
  }

  /** Current wall-clock in unix seconds (protected so tests can pin it). */
  protected nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }

  private mapRelayerError(err: unknown): HttpException {
    if (!(err instanceof RelayerTransferError)) this.logger.warn(`relayer call failed: ${String(err)}`);
    return mapRelayerTransferError(err, ROTATION_FAIL_MESSAGE);
  }

  /** Map a `WalletRotationError` to its HttpException; pass every other error through unchanged. */
  private rethrow(err: unknown): unknown {
    if (err instanceof WalletRotationError) {
      const [errorCode, status] = ROTATION_ERROR_MAP[err.reason];
      return this.fail(errorCode, status);
    }
    return err;
  }

  private fail(errorCode: ErrorCode, status: HttpStatus): HttpException {
    return failHttp(errorCode, status, ROTATION_FAIL_MESSAGE);
  }

  /**
   * 422 `ROTATION_BLOCKED_BY_LOCKUP` carrying a machine-readable `lockupExpiresAt` (ISO-8601 UTC) — the latest
   * blocking artist-retention unlock, so the FE composes curated copy without surfacing the raw message
   * (TOV-48 AC). `AllExceptionsFilter` spreads the object body, so the extra field is emitted (the
   * `failValidation` `errors[]` precedent). `artist_lockup_until` is epoch seconds (Number-safe).
   */
  private failLockup(lockupUntilSeconds: bigint): HttpException {
    return new HttpException(
      {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: ROTATION_FAIL_MESSAGE,
        errorCode: ErrorCode.ROTATION_BLOCKED_BY_LOCKUP,
        lockupExpiresAt: new Date(Number(lockupUntilSeconds) * 1000).toISOString(),
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
