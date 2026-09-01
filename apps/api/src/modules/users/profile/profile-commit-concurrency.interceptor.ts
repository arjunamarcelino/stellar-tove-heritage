import { CallHandler, ExecutionContext, HttpStatus, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { failHttp } from '@common/http/fail-http';
import { ErrorCode } from '@common/enums/error-code.enum';
import { PROFILE_COMMIT_MAX_CONCURRENCY } from './constants/profile-image.constants';

/**
 * Bounds aggregate in-flight commits per process (TOV-30 #411). `commitUpload` does a metadata size probe +
 * a (bounded) download + a synchronous sharp `metadata()` decode on the libuv threadpool; the per-user
 * throttle doesn't cap aggregate load (wallet-only users are cheap to mint), so a coordinated burst could
 * saturate the threadpool. Excess concurrent commits get a fast 503 to retry. Singleton → shared counter.
 */
@Injectable()
export class ProfileCommitConcurrencyInterceptor implements NestInterceptor {
  private inFlight = 0;

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.inFlight >= PROFILE_COMMIT_MAX_CONCURRENCY) {
      throw failHttp(
        ErrorCode.PROFILE_COMMIT_BUSY,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Too many commits in progress; retry shortly',
      );
    }
    this.inFlight++;
    return next.handle().pipe(finalize(() => (this.inFlight -= 1)));
  }
}
