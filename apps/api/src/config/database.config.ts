import { registerAs } from '@nestjs/config';
import { DB_DEFAULTS } from './database.defaults';

export const databaseConfig = registerAs('database', () => ({
  host: process.env.DB_HOST ?? DB_DEFAULTS.host,
  port: parseInt(process.env.DB_PORT ?? String(DB_DEFAULTS.port), 10),
  username: process.env.DB_USERNAME ?? DB_DEFAULTS.username,
  password: process.env.DB_PASSWORD ?? DB_DEFAULTS.password,
  database: process.env.DB_DATABASE ?? DB_DEFAULTS.database,
  migrationsRun: process.env.DB_MIGRATIONS_RUN !== 'false',
}));

export type DatabaseConfig = ReturnType<typeof databaseConfig>;
