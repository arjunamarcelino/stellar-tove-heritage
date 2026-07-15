import { createParamDecorator, ExecutionContext, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@common/enums/error-code.enum';
import { failHttp } from '@common/http/fail-http';

const MAX_LEN = 255;
const CHARSET = /^[A-Za-z0-9._-]+$/;

/**
 * Validate + normalize a required `Idempotency-Key` header value: present, ≤255 chars, and a clean opaque
 * token (`[A-Za-z0-9._-]`, so it can't inject Redis-key separators). Exported for unit tests.
 */
export function parseIdempotencyKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > MAX_LEN || !CHARSET.test(key)) {
    throw failHttp(
      ErrorCode.VALIDATION_FAILED,
      HttpStatus.BAD_REQUEST,
      'A valid Idempotency-Key header is required',
    );
  }
  return key;
}

/**
 * Required, edge-validated `Idempotency-Key` request header → 400 if missing/malformed. Keeps input
 * validation declarative at the boundary; the service then trusts the value (`@Headers` can't take a pipe).
 */
export const IdempotencyKey = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
  return parseIdempotencyKey(req.headers['idempotency-key']);
});
