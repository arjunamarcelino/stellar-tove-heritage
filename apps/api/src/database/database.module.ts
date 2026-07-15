import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigType } from '@nestjs/config';
import { databaseConfig } from '@config/database.config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (dbCfg: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres' as const,
        host: dbCfg.host,
        port: dbCfg.port,
        username: dbCfg.username,
        password: dbCfg.password,
        database: dbCfg.database,
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: dbCfg.migrationsRun,
        ...(dbCfg.migrationsRun
          ? { migrations: [__dirname + '/migrations/*{.ts,.js}'] }
          : {}),
        extra: {
          max: 20,
          min: 5,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        },
      }),
    }),
  ],
})
export class DatabaseModule {}
