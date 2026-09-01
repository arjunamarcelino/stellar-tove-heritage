import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { ErrorCode } from '@common/enums/error-code.enum';
import { failHttp } from '@common/http/fail-http';
import { kycConfig } from '@config/kyc.config';

/**
 * Server-wide concurrency gate for the KYC submit endpoint (review #187, partial). A single shared
 * counter caps simultaneous in-flight submissions; over the cap → 503 (backpressure). Placed BEFORE the
 * file interceptor in `@UseInterceptors`, so it rejects over-capacity requests *before* Multer buffers the
 * ~40MB body — bounding aggregate memory, which the per-user `@Throttle` does not. Singleton provider, so
 * the counter is shared across requests.
 *
 * NOTE: this only bounds concurrency/memory. The remaining #187 item (encryption runs synchronously on the
 * event loop; move to a worker pool) is still open.
 */
@Injectable()
export class KycConcurrencyInterceptor implements NestInterceptor {
  private inFlight = 0;

  constructor(@Inject(kycConfig.KEY) private readonly config: ConfigType<typeof kycConfig>) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.inFlight >= this.config.maxConcurrentSubmissions) {
      throw failHttp(
        ErrorCode.RATE_LIMITED,
        HttpStatus.SERVICE_UNAVAILABLE,
        'KYC submission capacity reached; please retry shortly',
      );
    }
    this.inFlight += 1;
    return next.handle().pipe(finalize(() => (this.inFlight -= 1)));
  }
}
