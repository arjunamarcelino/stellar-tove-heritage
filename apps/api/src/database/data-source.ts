import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { DB_DEFAULTS } from '@config/database.defaults';

dotenv.config();

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? DB_DEFAULTS.host,
  port: parseInt(process.env.DB_PORT ?? String(DB_DEFAULTS.port), 10),
  username: process.env.DB_USERNAME ?? DB_DEFAULTS.username,
  password: process.env.DB_PASSWORD ?? DB_DEFAULTS.password,
  database: process.env.DB_DATABASE ?? DB_DEFAULTS.database,
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  migrationsTransactionMode: 'each',
  synchronize: false,
});
