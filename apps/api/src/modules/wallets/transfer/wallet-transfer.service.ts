import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { relayerConfig } from '@config/relayer.config';
import { webauthnConfig } from '@config/webauthn.config';
import { ErrorCode } from '@common/enums/error-code.enum';
import { RELAYER_SERVICE, IRelayerService } from '@modules/relayer/relayer.service.interface';
import { RelayerTransferError, TransferErrorReason } from '@modules/relayer/relayer.errors';
import { failHttp, transferErrorMapping } from '@modules/relayer/transfer-error-http';
import { WalletsService } from '../wallets.service';
import { EmbeddedWalletNotFoundError } from '../embedded-wallet-not-found.error';
import { decodeCoseToRawP256 } from '../cose.helper';
import { BuildTransferDto } from './dto/build-transfer.dto';
import { BuildTransferResponseDto } from './dto/build-transfer-response.dto';
import { SubmitTransferDto } from './dto/submit-transfer.dto';
import { SubmitTransferResponseDto } from './dto/submit-transfer-response.dto';
import { scaleAmountToI128, USDC_DECIMALS } from './amount';

/**
 * Orchestrates the passkey-signed USDC transfer surface (TOV-22). Thin (holds no DataSource):
 * owner-scoped resolution of the caller's embedded wallet, amount validation + ceiling, delegation
 * to the RELAYER_SERVICE port, and mapping of domain/relayer errors to object-form HttpExceptions
 * carrying an explicit `errorCode` (per AllExceptionsFilter). Both `build` and `submit` ship; `submit`
 * refuses to submit without a valid passkey signature (the relayer verifies it fail-closed).
 */
@Injectable()
export class WalletTransferService {
  private readonly logger = new Logger(WalletTransferService.name);

  constructor(
    @Inject(relayerConfig.KEY) private readonly cfg: ConfigType<typeof relayerConfig>,
    @Inject(webauthnConfig.KEY) private readonly webauthn: ConfigType<typeof webauthnConfig>,
    @Inject(RELAYER_SERVICE) private readonly relayer: IRelayerService,
    private readonly walletsService: WalletsService,
  ) {}

  /** Build an unsigned transfer + the passkey challenge for the authenticated owner. */
  async build(userId: string, dto: BuildTransferDto): Promise<BuildTransferResponseDto> {
    // Owner-scoped: the `from` wallet comes from the JWT, never the request body.
    let resolution: Awaited<ReturnType<WalletsService['resolveEmbeddedWalletForUser']>>;
    try {
      resolution = await this.walletsService.resolveEmbeddedWalletForUser(userId);
    } catch (err) {
      if (err instanceof EmbeddedWalletNotFoundError) {
        throw this.fail(ErrorCode.WALLET_NOT_FOUND, HttpStatus.NOT_FOUND);
      }
      throw err;
    }

    // Scale + validate the amount (BigInt; enforces >0, <= i128, <= configured ceiling).
    let amountScaled: bigint;
    try {
      amountScaled = scaleAmountToI128(dto.amount, USDC_DECIMALS);
    } catch {
      throw this.fail(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    if (amountScaled > BigInt(this.cfg.maxTransferAmount)) {
      // Opaque-challenge compensating control: the passkey signs a hash, not a visible amount.
      throw this.fail(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }

    let result: Awaited<ReturnType<IRelayerService['buildTransfer']>>;
    try {
      result = await this.relayer.buildTransfer({
        walletContract: resolution.contractAddress,
        tokenContract: this.cfg.usdcTokenAddress,
        to: dto.to,
        amountScaled: amountScaled.toString(),
      });
    } catch (err) {
      if (err instanceof RelayerTransferError) {
        throw this.mapTransferError(err.reason);
      }
      this.logger.warn(`relayer buildTransfer failed: ${String(err)}`);
      throw this.fail(ErrorCode.TRANSFER_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return BuildTransferResponseDto.create({
      txXdr: result.txXdr,
      challenge: result.challenge,
      expiresAtLedger: result.expiresAtLedger,
      credentialId: resolution.credential.credentialId,
      transports: resolution.credential.transports,
      rpId: this.webauthn.rpId,
      to: dto.to,
      amount: dto.amount,
      amountScaled: amountScaled.toString(),
    });
  }

  /**
   * Verify the round-tripped passkey assertion + submit the transfer for the authenticated owner.
   * The relayer refuses to submit without a valid signature (fail-closed); this method resolves the
   * owner's wallet + bound key and maps relayer errors to errorCodes.
   */
  async submit(userId: string, dto: SubmitTransferDto): Promise<SubmitTransferResponseDto> {
    let resolution: Awaited<ReturnType<WalletsService['resolveEmbeddedWalletForUser']>>;
    try {
      resolution = await this.walletsService.resolveEmbeddedWalletForUser(userId);
    } catch (err) {
      if (err instanceof EmbeddedWalletNotFoundError) {
        throw this.fail(ErrorCode.WALLET_NOT_FOUND, HttpStatus.NOT_FOUND);
      }
      throw err;
    }

    // Decode the bound COSE credential to the raw P-256 point the signature verifies against.
    let boundPublicKey: Uint8Array;
    try {
      boundPublicKey = decodeCoseToRawP256(Uint8Array.from(resolution.credential.publicKey));
    } catch {
      // A passkey wallet must carry a decodable P-256 credential; absence is a data anomaly.
      throw this.fail(ErrorCode.TRANSFER_SIGNATURE_INVALID, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    try {
      const result = await this.relayer.submitSignedTransfer({
        txXdr: dto.txXdr,
        walletContract: resolution.contractAddress,
        tokenContract: this.cfg.usdcTokenAddress,
        boundPublicKey,
        credentialId: resolution.credential.credentialId,
        authenticatorData: Buffer.from(dto.authenticatorData, 'base64url'),
        clientDataJSON: Buffer.from(dto.clientDataJSON, 'base64url'),
        signature: Buffer.from(dto.signature, 'base64url'),
        rpId: this.webauthn.rpId,
        allowedOrigins: this.webauthn.origins,
        maxTransferAmount: this.cfg.maxTransferAmount,
      });
      return SubmitTransferResponseDto.create(result);
    } catch (err) {
      if (err instanceof RelayerTransferError) {
        throw this.mapTransferError(err.reason);
      }
      this.logger.warn(`relayer submitSignedTransfer failed: ${String(err)}`);
      throw this.fail(ErrorCode.TRANSFER_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  /** Map a terminal relayer transfer error to the HTTP status + errorCode for this surface. */
  private mapTransferError(reason: TransferErrorReason): HttpException {
    const [errorCode, status] = transferErrorMapping(reason);
    return this.fail(errorCode, status);
  }

  /** Object-form HttpException with an explicit errorCode (bypasses the status->code fallback). */
  private fail(errorCode: ErrorCode, status: HttpStatus): HttpException {
    return failHttp(errorCode, status, 'Transfer request failed');
  }
}
