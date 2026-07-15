import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@common/enums/error-code.enum';
import { failHttp } from '@common/http/fail-http';
import { RelayerTransferError, TransferErrorReason } from './relayer.errors';

export { failHttp };

/**
 * Single source of the relayer error taxonomy → (ErrorCode, HTTP status) projection, shared by every
 * consumer of the RELAYER_SERVICE money path (transfer TOV-22 + export TOV-40). Keyed by the closed
 * `TransferErrorReason` union, so it is exhaustive by construction — a new reason without a mapping is a
 * compile error, in ONE place.
 */
const TRANSFER_ERROR_MAP: Record<TransferErrorReason, [ErrorCode, HttpStatus]> = {
  simulation_failed: [ErrorCode.TRANSFER_SIMULATION_FAILED, HttpStatus.UNPROCESSABLE_ENTITY],
  expired: [ErrorCode.TRANSFER_EXPIRED, HttpStatus.CONFLICT],
  signature_required: [ErrorCode.TRANSFER_SIGNATURE_REQUIRED, HttpStatus.UNPROCESSABLE_ENTITY],
  signature_invalid: [ErrorCode.TRANSFER_SIGNATURE_INVALID, HttpStatus.UNPROCESSABLE_ENTITY],
  transfer_failed: [ErrorCode.TRANSFER_FAILED, HttpStatus.BAD_GATEWAY],
  unavailable: [ErrorCode.TRANSFER_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE],
};

/** The (ErrorCode, HttpStatus) for a relayer error reason (compile-time-exhaustive). */
export function transferErrorMapping(reason: TransferErrorReason): [ErrorCode, HttpStatus] {
  return TRANSFER_ERROR_MAP[reason];
}

/**
 * Map a caught relayer error to an HttpException. A terminal `RelayerTransferError` maps via the shared
 * table; anything else is a generic `TRANSFER_UNAVAILABLE` (503) — never a leaked 500.
 */
export function mapRelayerTransferError(err: unknown, message: string): HttpException {
  if (err instanceof RelayerTransferError) {
    const [errorCode, status] = TRANSFER_ERROR_MAP[err.reason];
    return failHttp(errorCode, status, message);
  }
  return failHttp(ErrorCode.TRANSFER_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE, message);
}
