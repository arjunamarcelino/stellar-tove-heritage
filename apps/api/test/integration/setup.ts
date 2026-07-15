import { DynamicModule, ForwardReference, Type } from '@nestjs/common';
import { Test, TestingModule, TestingModuleBuilder } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { appConfig } from '@config/app.config';
import { databaseConfig } from '@config/database.config';
import { jwtConfig } from '@config/jwt.config';
import { backofficeJwtConfig } from '@config/backoffice-jwt.config';
import { queueConfig } from '@config/queue.config';
import { sep10Config } from '@config/sep10.config';
import { webauthnConfig } from '@config/webauthn.config';
import { relayerConfig } from '@config/relayer.config';

type NestModule = Type | DynamicModule | Promise<DynamicModule> | ForwardReference;

/**
 * Uncompiled testing-module builder (so callers can `.overrideProvider(...)` before
 * compiling -- e.g. swapping the relayer port for a fake in passkey tests).
 */
export function createTestingModuleBuilder(...modules: NestModule[]): TestingModuleBuilder {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [appConfig, databaseConfig, jwtConfig, backofficeJwtConfig, queueConfig, sep10Config, webauthnConfig, relayerConfig],
        envFilePath: '.env.test',
        ignoreEnvFile: true,
      }),
      TypeOrmModule.forRoot({
        type: 'postgres',
        host: process.env.DB_HOST ?? 'localhost',
        port: parseInt(process.env.DB_PORT ?? '5432', 10),
        username: process.env.DB_USERNAME ?? 'tove',
        password: process.env.DB_PASSWORD ?? 'tove_secret',
        database: process.env.DB_DATABASE ?? 'tove_test',
        autoLoadEntities: true,
        synchronize: false,
        // Schema is loaded out-of-band via `yarn db:test:setup` (TypeORM cannot
        // load the .ts migrations at runtime under vitest/SWC). Tests run against
        // the pre-migrated tove_test database.
        migrationsRun: false,
      }),
      ...(modules ?? []),
    ],
  });
}

export async function createTestingModule(...modules: NestModule[]): Promise<TestingModule> {
  return createTestingModuleBuilder(...modules).compile();
}

export { truncateTables } from '../shared/helpers';
