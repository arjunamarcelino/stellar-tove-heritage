import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@common/enums/error-code.enum';

/** Reason phrases for the object-form error body's `error` field (kept in lockstep with the money surfaces). */
const REASON_PHRASE: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
  [HttpStatus.BAD_GATEWAY]: 'Bad Gateway',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
};

/**
 * Object-form `HttpException` carrying an explicit `errorCode` (consumed by `AllExceptionsFilter`). The one
 * error-body builder shared across surfaces — relayer transfer/export (see `transfer-error-http.ts`) and the
 * `me/wallets` identity surface — so the `{ statusCode, error, message, errorCode }` shape can't drift.
 */
export function failHttp(errorCode: ErrorCode, status: HttpStatus, message: string): HttpException {
  return new HttpException(
    { statusCode: status, error: REASON_PHRASE[status] ?? 'Error', message, errorCode },
    status,
  );
}
