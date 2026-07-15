import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { relayerConfig } from '@config/relayer.config';
import { webauthnConfig } from '@config/webauthn.config';
import { ErrorCode } from '@common/enums/error-code.enum';
import { assertNever } from '@common/utils/assert-never';
import { isUniqueConstraintError } from '@common/utils/database.utils';
import { RELAYER_SERVICE, IRelayerService } from '@modules/relayer/relayer.service.interface';
import { RelayerTransferError } from '@modules/relayer/relayer.errors';
import {
  failHttp,
  mapRelayerTransferError,
  transferErrorMapping,
} from '@modules/relayer/transfer-error-http';

const EXPORT_FAIL_MESSAGE = 'Export request failed';

/** Map the parent export status to the FE reconciliation state. Exhaustive (assertNever) — a new
 * WalletExportStatus without a case here is a compile error, not a silent fallthrough. */
function mapExportStateForRead(status: WalletExportStatus): ExportReadState {
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
import { WalletsService } from '../wallets.service';
import { Wallet } from '../entities/wallet.entity';
import { PasskeyCredential } from '../entities/passkey-credential.entity';
import { decodeCoseToRawP256 } from '../cose.helper';
import { USDC_DECIMALS } from '../transfer/amount';
import {
  WALLET_EXPORT_REPOSITORY,
  IWalletExportRepository,
} from './repositories/wallet-export-repository.interface';
import { KycAllowlistService } from './kyc-allowlist.service';
import { AuditLogService } from '../audit/audit-log.service';
import { AUDIT_KIND, AuditKind } from '../audit/audit-log.types';
import { canonicalizeStellarAddress, isStellarAccountAddress } from './stellar-address.util';
import { WalletExport } from './entities/wallet-export.entity';
import { WalletExportItem } from './entities/wallet-export-item.entity';
import { ExportTokenKind, WalletExportStatus } from './export-status.types';
import { ExportWalletDto } from './dto/export-wallet.dto';
import { ExportItemDto, ExportWalletResponseDto } from './dto/export-wallet-response.dto';
import { SubmitExportDto } from './dto/submit-export.dto';
import { SubmitExportItemResultDto, SubmitExportResponseDto } from './dto/submit-export-response.dto';
import { ExportReadState, ExportStatusResponseDto } from './dto/export-status-response.dto';

/**
 * Orchestrates the two-phase, stateful, resumable embedded-wallet export (TOV-40). Export is N
 * single-token transfers (Soroban = one op/tx), tracked per item for partial-failure safety. Reuses the
 * relayer's TOV-22 build/submit per item; pins the recipient + exact amount to server-trusted values;
 * re-validates the allowlist at submit; and latches the wallet `exported` only inside a row-locked
 * transaction, after every item confirmed AND a live re-read shows zero balances.
 */
@Injectable()
export class WalletExportService {
  private readonly logger = new Logger(WalletExportService.name);

  constructor(
    @Inject(relayerConfig.KEY) private readonly cfg: ConfigType<typeof relayerConfig>,
    @Inject(webauthnConfig.KEY) private readonly webauthn: ConfigType<typeof webauthnConfig>,
    @Inject(RELAYER_SERVICE) private readonly relayer: IRelayerService,
    @Inject(WALLET_EXPORT_REPOSITORY) private readonly exportRepo: IWalletExportRepository,
    private readonly walletsService: WalletsService,
    private readonly kyc: KycAllowlistService,
    private readonly audit: AuditLogService,
  ) {}

  /** Initiate or resume an export: validate, snapshot holdings, and return per-holding builds to sign. */
  async initiate(userId: string, walletId: string, dto: ExportWalletDto): Promise<ExportWalletResponseDto> {
    const { credential, contract: walletContract } = await this.resolveExportWallet(userId, walletId);

    // Target policy: canonical, self-custody G-address, not the caller's own wallet.
    let target: string;
    try {
      target = canonicalizeStellarAddress(dto.targetAddress);
    } catch {
      throw this.fail(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    if (!isStellarAccountAddress(target) || target === walletContract) {
      throw this.fail(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    if (!(await this.kyc.isAllowed(target))) {
      throw this.fail(ErrorCode.RECIPIENT_NOT_WHITELISTED, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    // Snapshot live holdings (USDC + each fraction); fail-closed if any read fails.
    const tokenContracts = [
      this.cfg.usdcTokenAddress,
      ...this.cfg.fractionTokens.map((t) => t.address),
    ].filter(Boolean);
    const nonZero = (await this.readHoldings(walletContract, tokenContracts)).filter((h) =>
      this.isPositive(h.amountScaled),
    );
    if (nonZero.length === 0) {
      throw this.fail(ErrorCode.EXPORT_NOT_AVAILABLE, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    // Find-or-create the single active export; target is frozen at first initiate.
    let exp = await this.exportRepo.findActiveByWalletIdWithItems(walletId);
    if (exp && exp.targetAddress !== target) {
      throw this.fail(ErrorCode.EXPORT_NOT_AVAILABLE, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (!exp) {
      try {
        exp = await this.exportRepo.createExport(walletId, userId, target);
      } catch (err) {
        if (!isUniqueConstraintError(err)) throw err;
        exp = await this.exportRepo.findActiveByWalletIdWithItems(walletId);
        if (!exp) throw this.fail(ErrorCode.EXPORT_NOT_AVAILABLE, HttpStatus.UNPROCESSABLE_ENTITY);
      }
    }

    // Display metadata (decimals + symbol) for the confirm screen, from config (immutable per token — no
    // per-initiate RPC). USDC is a constant; fractions come from RELAYER_FRACTION_TOKENS.
    const meta = new Map(this.cfg.fractionTokens.map((t) => [t.address, t]));

    // Build a transfer per still-pending holding; confirmed items are never rebuilt/re-transferred.
    const existingByToken = new Map((exp.items ?? []).map((i) => [i.tokenContract, i]));
    const items: ExportItemDto[] = [];
    for (const holding of nonZero) {
      const existing = existingByToken.get(holding.tokenContract);
      if (existing?.status === 'confirmed') continue;
      let built: Awaited<ReturnType<IRelayerService['buildTransfer']>>;
      try {
        built = await this.relayer.buildTransfer({
          walletContract,
          tokenContract: holding.tokenContract,
          to: target,
          amountScaled: holding.amountScaled,
        });
      } catch (err) {
        throw this.mapRelayerError(err);
      }
      const item = await this.exportRepo.upsertItemBuild({
        existingId: existing?.id,
        exportId: exp.id,
        tokenContract: holding.tokenContract,
        tokenKind: this.tokenKind(holding.tokenContract),
        amountScaled: holding.amountScaled,
        unsignedTxXdr: built.txXdr,
        expiresAtLedger: built.expiresAtLedger,
      });
      const isUsdc = holding.tokenContract === this.cfg.usdcTokenAddress;
      const m = meta.get(holding.tokenContract);
      const assetCode = isUsdc ? 'USDC' : m?.symbol || holding.tokenContract.slice(0, 6);
      items.push({
        itemId: item.id,
        tokenContract: item.tokenContract,
        tokenKind: item.tokenKind,
        amountScaled: item.amountScaled,
        decimals: isUsdc ? USDC_DECIMALS : (m?.decimals ?? 0),
        assetCode,
        displayName: assetCode, // artwork title enrichment is a follow-up (needs the M04 registry)
        challenge: built.challenge,
        expiresAtLedger: built.expiresAtLedger,
      });
    }

    await this.audit.record({
      actorType: 'user',
      actorId: userId,
      kind: AUDIT_KIND.EXPORT_REQUESTED,
      subjectType: 'wallet_export',
      subjectId: exp.id,
      payload: { target, itemCount: items.length },
    });

    return ExportWalletResponseDto.create({
      exportId: exp.id,
      targetAddress: target,
      credentialId: credential.credentialId,
      transports: credential.transports,
      rpId: this.webauthn.rpId,
      items,
    });
  }

  /** Submit signed assertions; confirm each item; latch the wallet exported only when all confirm. */
  async submit(userId: string, walletId: string, dto: SubmitExportDto): Promise<SubmitExportResponseDto> {
    const { credential, contract: walletContract } = await this.resolveExportWallet(userId, walletId);

    const exp = await this.exportRepo.findOwnedWithItems(dto.exportId, walletId, userId);
    if (!exp) throw this.fail(ErrorCode.EXPORT_NOT_FOUND, HttpStatus.UNPROCESSABLE_ENTITY);
    // Re-validate the allowlist at the moment of money movement (a revocation in the gap must block).
    if (!(await this.kyc.isAllowed(exp.targetAddress))) {
      throw this.fail(ErrorCode.RECIPIENT_NOT_WHITELISTED, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    await this.audit.record({
      actorType: 'user',
      actorId: userId,
      kind: AUDIT_KIND.EXPORT_SUBMIT,
      subjectType: 'wallet_export',
      subjectId: exp.id,
      payload: { itemCount: dto.items.length },
    });

    let boundPublicKey: Uint8Array;
    try {
      boundPublicKey = decodeCoseToRawP256(Uint8Array.from(credential.publicKey));
    } catch {
      throw this.fail(ErrorCode.TRANSFER_SIGNATURE_INVALID, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const itemById = new Map(exp.items.map((i) => [i.id, i]));
    const results: SubmitExportItemResultDto[] = [];
    for (const submitted of dto.items) {
      const item = itemById.get(submitted.itemId);
      if (!item) {
        results.push({ itemId: submitted.itemId, status: 'failed', errorCode: ErrorCode.EXPORT_NOT_FOUND });
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
        // No stored build (never built, or cleared) — the client must re-initiate for a fresh challenge.
        results.push({ itemId: item.id, status: 'failed', errorCode: ErrorCode.TRANSFER_EXPIRED });
        continue;
      }
      // Single-writer per item (todo 125): atomically claim pending/failed -> submitted. A concurrent
      // submit that loses the CAS must not re-send this item; report it as in-flight ('submitted').
      if (!(await this.exportRepo.claimItemForSubmit(item.id))) {
        results.push({ itemId: item.id, status: 'submitted' });
        continue;
      }
      // Re-validate the allowlist per item (todo 128): the drain can span many seconds, so a compliance
      // revocation that lands mid-loop must block the remaining items — the target is authoritative at
      // each money movement, not just at submit start.
      if (!(await this.kyc.isAllowed(exp.targetAddress))) {
        await this.exportRepo.markItemFailed(item.id, ErrorCode.RECIPIENT_NOT_WHITELISTED);
        item.status = 'failed';
        await this.auditItem(AUDIT_KIND.EXPORT_FAILED, userId, exp.id, item, {
          errorCode: ErrorCode.RECIPIENT_NOT_WHITELISTED,
        });
        results.push({ itemId: item.id, status: 'failed', errorCode: ErrorCode.RECIPIENT_NOT_WHITELISTED });
        continue;
      }
      try {
        const res = await this.relayer.submitSignedTransfer({
          txXdr: item.unsignedTxXdr, // the STORED tx — never the client body
          walletContract,
          tokenContract: item.tokenContract,
          boundPublicKey,
          credentialId: credential.credentialId,
          authenticatorData: Buffer.from(submitted.authenticatorData, 'base64url'),
          clientDataJSON: Buffer.from(submitted.clientDataJSON, 'base64url'),
          signature: Buffer.from(submitted.signature, 'base64url'),
          rpId: this.webauthn.rpId,
          allowedOrigins: this.webauthn.origins,
          maxTransferAmount: item.amountScaled, // cap = the frozen snapshot balance
          expectedTo: exp.targetAddress,
          expectedAmountScaled: item.amountScaled,
        });
        await this.exportRepo.markItemConfirmed(item.id, res.txHash, res.ledger);
        item.status = 'confirmed';
        item.txHash = res.txHash;
        item.ledger = res.ledger;
        await this.auditItem(AUDIT_KIND.EXPORT_CONFIRMED, userId, exp.id, item, {
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
        await this.exportRepo.markItemFailed(item.id, errorCode);
        item.status = 'failed';
        await this.auditItem(AUDIT_KIND.EXPORT_FAILED, userId, exp.id, item, { errorCode });
        results.push({ itemId: item.id, status: 'failed', errorCode });
      }
    }

    // Completion: every item confirmed AND a live re-read shows zero balances → latch exported (in a
    // row-locked tx that re-counts against the DB, the authoritative guard against a partial-latch race).
    const allConfirmed = exp.items.length > 0 && exp.items.every((i) => i.status === 'confirmed');
    let allZero = false;
    if (allConfirmed) {
      try {
        const holdings = await this.readHoldings(
          walletContract,
          exp.items.map((i) => i.tokenContract),
        );
        allZero = holdings.every((h) => !this.isPositive(h.amountScaled));
      } catch {
        allZero = false; // a failed re-read must not latch exported
      }
    }
    const walletExported = await this.exportRepo.finalizeIfAllConfirmed(
      exp.id,
      walletId,
      allZero,
      (manager) => this.walletsService.markWalletExported(walletId, manager),
      async (manager) => {
        // User-initiated confirm: actorType 'user' (not 'system') carrying the caller's id.
        await this.audit.record(
          {
            actorType: 'user',
            actorId: userId,
            kind: AUDIT_KIND.EXPORT_CONFIRMED,
            subjectType: 'wallet_export',
            subjectId: exp.id,
            payload: { target: exp.targetAddress },
          },
          manager,
        );
      },
    );

    const status: WalletExportStatus = walletExported ? 'completed' : 'submitting';
    return SubmitExportResponseDto.create({ exportId: exp.id, status, walletExported, items: results });
  }

  /** Reconciliation read for the FE — explicit pending/submitting so it never blind-resubmits. */
  async status(userId: string, walletId: string): Promise<ExportStatusResponseDto> {
    const wallet = await this.walletsService.findOwnedWallet(userId, walletId);
    if (!wallet) throw this.fail(ErrorCode.WALLET_NOT_FOUND, HttpStatus.NOT_FOUND);

    let exp = await this.exportRepo.findLatestByWalletIdWithItems(walletId);
    if (!exp) {
      return ExportStatusResponseDto.create({ exportId: null, state: 'none', items: [] });
    }
    // Lazy crash-recovery (todo 127): reconcile any item stuck `submitted` (sent on-chain but the DB
    // confirm was lost) using the live balance — a drained token proves the transfer landed. Runs on the
    // FE's reconciliation-poll path; re-loads to reflect any latch.
    if (wallet.contractAddress && exp.items.some((i) => i.status === 'submitted')) {
      await this.reconcileStuckItems(wallet.contractAddress, walletId, exp);
      exp = (await this.exportRepo.findLatestByWalletIdWithItems(walletId)) ?? exp;
    }
    const state = mapExportStateForRead(exp.status);
    return ExportStatusResponseDto.create({
      exportId: exp.id,
      state,
      selfCustodyAddress: exp.targetAddress,
      items: exp.items.map((i) => ({
        tokenContract: i.tokenContract,
        tokenKind: i.tokenKind,
        status: i.status,
        txHash: i.txHash ?? undefined,
      })),
    });
  }

  /**
   * Owner-scoped wallet resolution for initiate/submit: 404 WALLET_NOT_FOUND when not owned/absent;
   * 422 EXPORT_NOT_AVAILABLE for a byow or already-exported wallet (the AC distinguishes these from a
   * missing wallet); a missing credential on an embedded wallet is a data anomaly → 404.
   */
  private async resolveExportWallet(
    userId: string,
    walletId: string,
  ): Promise<{ wallet: Wallet; credential: PasskeyCredential; contract: string }> {
    const wallet = await this.walletsService.findOwnedWallet(userId, walletId);
    if (!wallet) throw this.fail(ErrorCode.WALLET_NOT_FOUND, HttpStatus.NOT_FOUND);
    if (wallet.kind !== 'embedded_passkey' || !wallet.contractAddress) {
      throw this.fail(ErrorCode.EXPORT_NOT_AVAILABLE, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    // The one-way latch gets its own code + 409 so the FE can distinguish "already exported" copy from
    // byow / empty (EXPORT_NOT_AVAILABLE).
    if (wallet.status === 'exported') {
      throw this.fail(ErrorCode.ALREADY_EXPORTED, HttpStatus.CONFLICT);
    }
    const credential = await this.walletsService.getWalletCredential(wallet.id);
    if (!credential) {
      this.logger.warn(`embedded wallet has no bound credential [wallet=${wallet.id}]`);
      throw this.fail(ErrorCode.WALLET_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return { wallet, credential, contract: wallet.contractAddress };
  }

  /**
   * Crash-recovery (todo 127): for items stuck `submitted` (on-chain send succeeded but the DB confirm
   * was lost), read the live balance — a drained (zero) token proves the transfer landed, so reconcile
   * it to `confirmed`. If that completes the export, latch the wallet via the same finalize gate.
   * Best-effort: a failed balance read leaves the item stuck for the next poll.
   */
  private async reconcileStuckItems(walletContract: string, walletId: string, exp: WalletExport): Promise<void> {
    const stuck = exp.items.filter((i) => i.status === 'submitted');
    if (stuck.length === 0) return;
    let holdings: Awaited<ReturnType<IRelayerService['readWalletHoldings']>>;
    try {
      holdings = await this.relayer.readWalletHoldings({
        walletContract,
        tokenContracts: stuck.map((i) => i.tokenContract),
      });
    } catch {
      return; // leave stuck items for the next reconciliation poll
    }
    const balByToken = new Map(holdings.map((h) => [h.tokenContract, h.amountScaled]));
    for (const item of stuck) {
      if (!this.isPositive(balByToken.get(item.tokenContract) ?? '0')) {
        this.logger.warn(`reconciling crash-stuck export item to confirmed [item=${item.id}]`);
        if (await this.exportRepo.reconcileItemConfirmed(item.id)) item.status = 'confirmed';
      }
    }
    // If reconciliation completed the export, latch the wallet (idempotent; DB re-count is authoritative).
    if (exp.items.length > 0 && exp.items.every((i) => i.status === 'confirmed')) {
      await this.exportRepo.finalizeIfAllConfirmed(
        exp.id,
        walletId,
        true,
        (manager) => this.walletsService.markWalletExported(walletId, manager),
        async (manager) => {
          await this.audit.record(
            {
              actorType: 'system',
              actorId: null,
              kind: AUDIT_KIND.EXPORT_CONFIRMED,
              subjectType: 'wallet_export',
              subjectId: exp.id,
              payload: { target: exp.targetAddress, reconciled: true },
            },
            manager,
          );
        },
      );
    }
  }

  /** Append a per-item audit row (subject = the export item) for AML reconstruction of exactly what
   * moved / failed. Best-effort (non-transactional) — the item state is already persisted (todo 142). */
  private async auditItem(
    kind: AuditKind,
    userId: string,
    exportId: string,
    item: WalletExportItem,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      actorType: 'user',
      actorId: userId,
      kind,
      subjectType: 'wallet_export_item',
      subjectId: item.id,
      payload: { export: exportId, tokenContract: item.tokenContract, ...payload },
    });
  }

  private async readHoldings(walletContract: string, tokenContracts: string[]) {
    try {
      return await this.relayer.readWalletHoldings({ walletContract, tokenContracts });
    } catch (err) {
      throw this.mapRelayerError(err);
    }
  }

  private isPositive(amountScaled: string): boolean {
    try {
      return BigInt(amountScaled) > 0n;
    } catch {
      return false;
    }
  }

  private tokenKind(tokenContract: string): ExportTokenKind {
    return tokenContract === this.cfg.usdcTokenAddress ? 'usdc' : 'fraction';
  }

  private mapRelayerError(err: unknown): HttpException {
    if (!(err instanceof RelayerTransferError)) this.logger.warn(`relayer call failed: ${String(err)}`);
    return mapRelayerTransferError(err, EXPORT_FAIL_MESSAGE);
  }

  private fail(errorCode: ErrorCode, status: HttpStatus): HttpException {
    return failHttp(errorCode, status, EXPORT_FAIL_MESSAGE);
  }
}
