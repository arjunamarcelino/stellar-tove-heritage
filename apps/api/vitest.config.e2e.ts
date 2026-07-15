import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/e2e/**/*.e2e-spec.ts'],
    testTimeout: 30000,
    fileParallelism: false,
    env: {
      // Use a local, schema-preloaded test database (run migrations once via the
      // CLI before running e2e). These override .env so the suite never hits the
      // shared remote dev DB/Redis, which is the source of connection-timeout flakes.
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USERNAME: 'tove',
      DB_PASSWORD: 'tove_secret',
      DB_DATABASE: 'tove_test',
      DB_MIGRATIONS_RUN: 'false',
      REDIS_HOST: 'localhost',
      REDIS_PORT: '6379',
      REDIS_PASSWORD: '',
      // SEP-10: a throwaway Testnet server keypair so AppModule boots (secret is Joi-required).
      SEP10_SERVER_SIGNING_SECRET: 'SDQCDUFEUCRDDPP2VTINRO7OLNQC3Z7ER2BQKUTKHMHCBRU6X2VC7RQF',
      SEP10_HOME_DOMAIN: 'tove.io',
      SEP10_WEB_AUTH_DOMAIN: 'auth.tove.io',
      SEP10_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
      // WebAuthn: rpId/origin must match the software authenticator helper.
      WEBAUTHN_RP_ID: 'tove.io',
      WEBAUTHN_ORIGIN: 'https://tove.io',
      // Relayer: throwaway values so AppModule's Joi passes to boot (secret 56, wasm 64-hex).
      // The relayer port is overridden with a fake, so these are never used to sign.
      RELAYER_SECRET: 'SDQCDUFEUCRDDPP2VTINRO7OLNQC3Z7ER2BQKUTKHMHCBRU6X2VC7RQF',
      RELAYER_WALLET_WASM_HASH: 'ab'.repeat(32),
      RELAYER_FACTORY_ADDRESS: 'CAZOVWDKGNPMSF7GJ3FKW7M7WGTQDUKDGC3VNVSN4TQYCXBHT53LHEZC',
      RELAYER_WEBAUTHN_VERIFIER_ADDRESS: 'CBRHXSWJPTNSHCLLX2QPA7THILWIY3BKJLPFI4GYJLDNPQRAI2ROOBME',
      // TOV-22: USDC token id is Joi-required; the fake relayer never uses it.
      RELAYER_USDC_TOKEN_ADDRESS: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
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
