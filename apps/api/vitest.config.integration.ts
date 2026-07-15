import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/integration/**/*.spec.ts'],
    testTimeout: 30000,
    // Integration files share one tove_test database and truncate between tests,
    // so they must not run in parallel (one file's truncate would wipe another's
    // data mid-test).
    fileParallelism: false,
    env: {
      // Pin the DB to the local tove_test database so an exported DB_DATABASE /
      // DB_HOST can never point the suite (which TRUNCATEs every table) at a
      // dev/prod database. Mirrors vitest.config.e2e.ts.
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USERNAME: 'tove',
      DB_PASSWORD: 'tove_secret',
      DB_DATABASE: 'tove_test',
      // JWT secrets so AuthService can sign tokens (min 32 chars).
      JWT_ACCESS_SECRET: 'test_access_secret_at_least_32_chars_long',
      JWT_REFRESH_SECRET: 'test_refresh_secret_at_least_32_chars_long',
      REFRESH_TOKEN_HMAC_SECRET: 'test_hmac_secret_at_least_32_chars_long',
      // AuthModule eagerly builds the SEP-10 server keypair on construction.
      SEP10_SERVER_SIGNING_SECRET: 'SDQCDUFEUCRDDPP2VTINRO7OLNQC3Z7ER2BQKUTKHMHCBRU6X2VC7RQF',
      // WebAuthn: rpId/origin must match the software authenticator helper.
      WEBAUTHN_RP_ID: 'tove.io',
      WEBAUTHN_ORIGIN: 'https://tove.io',
      LOG_LEVEL: 'silent',
    },
    alias: {
      '@common': resolve(__dirname, './src/common'),
      '@modules': resolve(__dirname, './src/modules'),
      '@config': resolve(__dirname, './src/config'),
      '@database': resolve(__dirname, './src/database'),
    },
  },
  plugins: [swc.vite()],
});
