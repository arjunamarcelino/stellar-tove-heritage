import { Module } from '@nestjs/common';
import { RELAYER_SERVICE } from './relayer.service.interface';
import { SorobanRelayerService } from './soroban-relayer.service';
import { RELAYER_ACCOUNT_LOCK } from './relayer-account-lock.interface';
import { RedisRelayerAccountLock } from './redis-relayer-account-lock';

/**
 * Neutral relayer domain: exposes the `RELAYER_SERVICE` port backed by the Soroban
 * adapter, plus a `RELAYER_ACCOUNT_LOCK` (Redis) that serializes every sequence-consuming
 * submission (deploy AND transfer) on the shared relayer account across instances. Consumed by
 * `auth` (passkey registration) + `wallets/transfer`. Tests override the port with an in-memory
 * fake, so neither the adapter nor Redis is touched.
 */
@Module({
  providers: [
    { provide: RELAYER_SERVICE, useClass: SorobanRelayerService },
    { provide: RELAYER_ACCOUNT_LOCK, useClass: RedisRelayerAccountLock },
  ],
  // RELAYER_ACCOUNT_LOCK is exported so the fractionalization deploy service (TOV-233) reuses the same
  // Redis-backed lock provider under its own key (`relayer:fraction:account`) — one connection, keyed
  // serialization per relayer account.
  exports: [RELAYER_SERVICE, RELAYER_ACCOUNT_LOCK],
})
export class RelayerModule {}
