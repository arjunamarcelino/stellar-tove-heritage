import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Response } from 'express';
import { appConfig } from '@config/app.config';
import { ErrorCode } from '@common/enums/error-code.enum';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(
    @Inject(appConfig.KEY)
    private readonly appCfg: ConfigType<typeof appConfig>,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const status: HttpStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Unhandled exception: ${exception instanceof Error ? exception.message : 'Unknown error'}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const isProduction = this.appCfg.nodeEnv === 'production';
    const isHttpException = exception instanceof HttpException;

    let errorResponse: Record<string, unknown>;
    if (isHttpException) {
      errorResponse =
        typeof message === 'string'
          ? { statusCode: status, message, error: HttpStatus[status] }
          : (message as Record<string, unknown>);
    } else {
      // Never leak internal error details to clients
      errorResponse = {
        statusCode: status,
        message: 'Internal server error',
        error: HttpStatus[status],
      };
    }

    const errorCode = this.resolveErrorCode(status, errorResponse);

    response.status(status).json({
      ...errorResponse,
      errorCode,
      ...(isProduction ? {} : { timestamp: new Date().toISOString() }),
    });
  }

  private resolveErrorCode(
    status: HttpStatus,
    errorResponse: Record<string, unknown>,
  ): ErrorCode {
    // If the response already has an errorCode, use it
    if (errorResponse['errorCode'] && typeof errorResponse['errorCode'] === 'string') {
      return errorResponse['errorCode'] as ErrorCode;
    }

    // Map HTTP status codes to default error codes
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_FAILED;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.AUTH_INVALID_CREDENTIALS;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.AUTH_EMAIL_CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMITED;
      default:
        return ErrorCode.INTERNAL_ERROR;
    }
  }
}
