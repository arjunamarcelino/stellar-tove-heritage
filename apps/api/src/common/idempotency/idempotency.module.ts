import { Module } from '@nestjs/common';
import { IdempotencyStore } from './idempotency-store';

/**
 * Shared HTTP idempotency primitive (TOV-24). Provides a single {@link IdempotencyStore} instance for any
 * surface that needs `Idempotency-Key` semantics (currently the `me/wallets` add; the mainnet passkey/auth
 * money-surface hardening is a documented future consumer). Import this module rather than re-declaring the
 * provider, so all consumers share one Redis connection.
 */
@Module({
  providers: [IdempotencyStore],
  exports: [IdempotencyStore],
})
export class IdempotencyModule {}
