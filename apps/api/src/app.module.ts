import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Redis } from 'ioredis';
import { LoggerModule } from 'nestjs-pino';
import pino from 'pino';
import { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { redactUrlQueryParams, REDACTED_QUERY_PARAMS } from '@common/logging/redact-query.util';
import { appConfig } from '@config/app.config';
import { databaseConfig } from '@config/database.config';
import { jwtConfig } from '@config/jwt.config';
import { backofficeJwtConfig } from '@config/backoffice-jwt.config';
import { queueConfig } from '@config/queue.config';
import { redisConfig } from '@config/redis.config';
import { throttleConfig } from '@config/throttle.config';
import { supabaseConfig } from '@config/supabase.config';
import { filesConfig } from '@config/files.config';
import { loggerConfig } from '@config/logger.config';
import { sep10Config } from '@config/sep10.config';
import { webauthnConfig } from '@config/webauthn.config';
import { relayerConfig } from '@config/relayer.config';
import { kycConfig } from '@config/kyc.config';
import { fractionFactoryConfig } from '@config/fraction-factory.config';
import { fractionReadConfig } from '@config/fraction-read.config';
import { walletTrustlineConfig } from '@config/wallet-trustline.config';
import { marketplaceSettlementConfig } from '@config/marketplace-settlement.config';
import { kycAllowlistConfig } from '@config/kyc-allowlist.config';
import { offeringEscrowConfig } from '@config/offering-escrow.config';
import { offeringBidConfig } from '@config/offering-bid.config';
import { rfqFanoutConfig } from '@config/rfq-fanout.config';
import { profileImageConfig } from '@config/profile-image.config';
import { beneficiaryConfig } from '@config/beneficiary.config';
import { validationSchema } from '@config/validation-schema';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '@database/database.module';
import { AuthGuard } from '@common/guards/auth.guard';
import { UserAwareThrottlerGuard } from '@common/guards/user-aware-throttler.guard';
import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';
import { UsersModule } from '@modules/users/users.module';
import { JobsModule } from '@modules/jobs/jobs.module';
import { KycSweepModule } from '@modules/kyc/sweep/kyc-sweep.module';
import { FractionDeployWorkerModule } from '@modules/fractionalization/deploy/fraction-deploy-worker.module';
import { OfferingWorkerModule } from '@modules/offerings/deploy/offering-worker.module';
import { OfferingBidWorkerModule } from '@modules/offerings/bids/escrow/offering-bid-worker.module';
import { OfferingBidCancelWorkerModule } from '@modules/offerings/bids/cancel/offering-bid-cancel-worker.module';
import { OfferingSettleWorkerModule } from '@modules/offerings/settle/offering-settle-worker.module';
import { RfqFanoutWorkerModule } from '@modules/marketplace/notifications/fanout/rfq-fanout-worker.module';
import { QuoteSettleWorkerModule } from '@modules/marketplace/settlement/settle/quote-settle-worker.module';
import { ProfileDerivativeWorkerModule } from '@modules/users/profile/derivatives/profile-derivative-worker.module';
import { ProfileImageMaintenanceModule } from '@modules/users/profile/maintenance/profile-image-maintenance.module';
import { BeneficiaryErasureSweepModule } from '@modules/users/beneficiary/erasure-sweep/beneficiary-erasure-sweep.module';
import { PublicApiModule } from '@modules/public-api.module';
import { BackofficeModule } from '@modules/backoffice/backoffice.module';
import { BullModule } from '@nestjs/bullmq';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, jwtConfig, backofficeJwtConfig, queueConfig, redisConfig, throttleConfig, supabaseConfig, filesConfig, loggerConfig, sep10Config, webauthnConfig, relayerConfig, kycConfig, fractionFactoryConfig, fractionReadConfig, walletTrustlineConfig, kycAllowlistConfig, offeringEscrowConfig, offeringBidConfig, rfqFanoutConfig, marketplaceSettlementConfig, profileImageConfig, beneficiaryConfig],
      validationSchema,
    }),
    LoggerModule.forRootAsync({
      inject: [loggerConfig.KEY],
      useFactory: (logCfg: ConfigType<typeof loggerConfig>) => ({
        pinoHttp: {
          level: logCfg.level,
          transport: logCfg.prettyPrint
            ? {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  translateTime: 'SYS:standard',
                  ignore: 'pid,hostname',
                  singleLine: true,
                },
              }
            : undefined,
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const existing = req.headers['x-request-id'];
            const id = typeof existing === 'string' && UUID_RE.test(existing)
              ? existing
              : randomUUID();
            res.setHeader('X-Request-Id', id);
            return id;
          },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              // Referer carries the full previous URL — including ?handle=… or /collectors/<handle> —
              // on the NEXT request, so it would re-leak the handle the url-scrub below strips (TOV-27).
              'req.headers.referer',
              'req.headers.referrer',
              'res.headers["set-cookie"]',
            ],
            censor: '[REDACTED]',
          },
          // The query string is embedded in `req.url` (a leaf string), so `redact.paths` can't reach it.
          // Scrub sensitive query params (e.g. ?handle=…) from the logged URL via the request serializer.
          serializers: {
            req: pino.stdSerializers.wrapRequestSerializer((req) => {
              if (typeof req.url === 'string') {
                req.url = redactUrlQueryParams(req.url, REDACTED_QUERY_PARAMS);
              }
              return req;
            }),
          },
        },
        exclude: [{ method: RequestMethod.ALL, path: 'health' }],
      }),
    }),
    DatabaseModule,
    // Redis-backed storage so per-route @Throttle limits (e.g. the public /handles/check
    // anti-enumeration limit, TOV-26) are shared across app instances and survive restarts, rather than
    // being per-process in-memory. `lazyConnect` (mirrors IdempotencyStore) means tests that override
    // ThrottlerStorage with a no-op never open a connection. Redis is already a hard app dependency
    // (idempotency store, BullMQ), so this adds no new availability class.
    ThrottlerModule.forRootAsync({
      inject: [throttleConfig.KEY, redisConfig.KEY],
      useFactory: (
        tCfg: ConfigType<typeof throttleConfig>,
        rCfg: ConfigType<typeof redisConfig>,
      ) => ({
        throttlers: [{ ttl: tCfg.ttl, limit: tCfg.limit }],
        storage: new ThrottlerStorageRedisService(
          new Redis({
            host: rCfg.host,
            port: rCfg.port,
            password: rCfg.password,
            maxRetriesPerRequest: null,
            lazyConnect: true,
          }),
        ),
      }),
    }),
    BullModule.forRootAsync({
      inject: [queueConfig.KEY],
      useFactory: (qCfg: ConfigType<typeof queueConfig>) => ({
        connection: {
          host: qCfg.host,
          port: qCfg.port,
          password: qCfg.password,
          maxRetriesPerRequest: null,
        },
      }),
    }),
    // Provides JwtService for the global AuthGuard registered below. Kept
    // explicit here (rather than relying on a re-export from a feature module)
    // since the guard is app-level infrastructure.
    JwtModule.register({}),
    UsersModule,
    JobsModule,
    KycSweepModule,
    FractionDeployWorkerModule,
    OfferingWorkerModule,
    OfferingBidWorkerModule,
    OfferingBidCancelWorkerModule,
    OfferingSettleWorkerModule,
    RfqFanoutWorkerModule,
    QuoteSettleWorkerModule,
    ProfileDerivativeWorkerModule,
    ProfileImageMaintenanceModule,
    BeneficiaryErasureSweepModule,
    PublicApiModule,
    BackofficeModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Rate limit first, keyed on JWT `sub` (per-identity) with IP fallback — see UserAwareThrottlerGuard.
    { provide: APP_GUARD, useClass: UserAwareThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
