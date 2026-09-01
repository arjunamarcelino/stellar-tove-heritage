import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';
import { ErrorCode } from '@common/enums/error-code.enum';

/**
 * Multer raises `MulterError` from INSIDE the file interceptor (before the handler), and it does NOT extend
 * `HttpException` — so the global `AllExceptionsFilter` would render it as a generic 500. Map the ones the
 * KYC multipart endpoint can trigger to their 422 `ErrorCode` (SEC-H4 / best-practices). Registered globally
 * via `APP_FILTER`; `@Catch(MulterError)` is more specific than the catch-all, so it wins.
 */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  // Keyed by Multer's own error-code union (not `string`), so a typo'd key is a compile error.
  private static readonly MAP: Partial<Record<MulterError['code'], ErrorCode>> = {
    LIMIT_FILE_SIZE: ErrorCode.KYC_FILE_TOO_LARGE,
    LIMIT_UNEXPECTED_FILE: ErrorCode.KYC_UNEXPECTED_DOCUMENT,
    LIMIT_FILE_COUNT: ErrorCode.KYC_UNEXPECTED_DOCUMENT,
    LIMIT_PART_COUNT: ErrorCode.KYC_UNEXPECTED_DOCUMENT,
    LIMIT_FIELD_COUNT: ErrorCode.KYC_UNEXPECTED_DOCUMENT,
  };

  catch(err: MulterError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const status = HttpStatus.UNPROCESSABLE_ENTITY;
    const errorCode = MulterExceptionFilter.MAP[err.code] ?? ErrorCode.VALIDATION_FAILED;
    res.status(status).json({
      statusCode: status,
      error: 'Unprocessable Entity',
      message: err.field ? `${err.message} (${err.field})` : err.message,
      errorCode,
    });
  }
}
