import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AppModule } from '../../src/app.module';
import { RELAYER_SERVICE } from '../../src/modules/relayer/relayer.service.interface';
import { noOpThrottlerStorage } from '../shared/helpers';
import { FakeRelayerService } from '../shared/fake-relayer';
import { createSoftwarePasskey, buildAttestation, type SoftwarePasskey } from '../shared/webauthn-authenticator';

const BEGIN = '/api/v1/auth/passkey/register/begin';
const FINISH = '/api/v1/auth/passkey/register/finish';
const RP_ID = 'tove.io';
const ORIGIN = 'https://tove.io';

interface BeginResponse {
  options: { challenge: string };
}
interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  contractAddress?: string;
}
interface ErrorResponse {
  errorCode: string;
}

function decodeSub(jwt: string): string {
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()) as {
    sub: string;
  };
  return payload.sub;
}

describe('Passkey registration (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: object;
  const relayer = new FakeRelayerService();

  const query = async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
    const rows: unknown = await dataSource.query(sql, params);
    return rows as T[];
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noOpThrottlerStorage)
      .overrideProvider(RELAYER_SERVICE)
      .useValue(relayer)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    dataSource = app.get(DataSource);
    server = app.getHttpServer() as object;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    for (const entity of dataSource.entityMetadatas) {
      await dataSource.getRepository(entity.name).query(`TRUNCATE TABLE "${entity.tableName}" CASCADE`);
    }
  });

  async function begin(email: string, passkey: SoftwarePasskey, origin = ORIGIN) {
    const res = await request(server).post(BEGIN).send({ email }).expect(200);
    const body = res.body as BeginResponse;
    return buildAttestation({ passkey, challenge: body.options.challenge, rpId: RP_ID, origin });
  }

  it('AC-1: registers a passkey, deploys a smart wallet, returns 201 + tokens + cookie + rows', async () => {
    const passkey = createSoftwarePasskey();
    const attestationResponse = await begin('collector@example.com', passkey);

    const res = await request(server)
      .post(FINISH)
      .send({ email: 'collector@example.com', attestationResponse })
      .expect(201);

    const body = res.body as TokenResponse;
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => c.startsWith('refresh_token='))).toBe(true);

    const wallets = await query<{ kind: string; contract_address: string | null; public_key: string | null }>(
      `SELECT kind, contract_address, public_key FROM wallets`,
    );
    expect(wallets).toHaveLength(1);
    expect(wallets[0].kind).toBe('embedded_passkey');
    expect(wallets[0].contract_address).toBeTruthy();
    expect(wallets[0].public_key).toBeNull();
    // 201 surfaces the deployed smart-wallet address, matching the persisted row.
    expect(body.contractAddress).toBe(wallets[0].contract_address);

    const creds = await query<{ id: string }>(`SELECT id FROM passkey_credentials`);
    expect(creds).toHaveLength(1);

    const users = await query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
      'collector@example.com',
    ]);
    expect(decodeSub(body.accessToken)).toBe(users[0].id);
  });

  it('AC-2: reusing a bound credential rejects with 409 PASSKEY_ALREADY_BOUND', async () => {
    const passkey = createSoftwarePasskey();
    const first = await begin('first@example.com', passkey);
    await request(server).post(FINISH).send({ email: 'first@example.com', attestationResponse: first }).expect(201);

    const second = await begin('second@example.com', passkey);
    const res = await request(server)
      .post(FINISH)
      .send({ email: 'second@example.com', attestationResponse: second })
      .expect(409);
    expect((res.body as ErrorResponse).errorCode).toBe('PASSKEY_ALREADY_BOUND');
  });

  it('begin with an already-registered email -> 409 AUTH_EMAIL_CONFLICT', async () => {
    await dataSource.query(`INSERT INTO users (email, password_hash, is_active) VALUES ($1,$2,true)`, [
      'taken@example.com',
      '$2b$12$abcdefghijklmnopqrstuv',
    ]);
    const res = await request(server).post(BEGIN).send({ email: 'taken@example.com' }).expect(409);
    expect((res.body as ErrorResponse).errorCode).toBe('AUTH_EMAIL_CONFLICT');
  });

  it('finish with an expired challenge -> 401 AUTH_CHALLENGE_EXPIRED', async () => {
    const passkey = createSoftwarePasskey();
    const attestationResponse = await begin('exp@example.com', passkey);
    await dataSource.query(`UPDATE passkey_challenges SET expires_at = now() - interval '1 minute'`);

    const res = await request(server)
      .post(FINISH)
      .send({ email: 'exp@example.com', attestationResponse })
      .expect(401);
    expect((res.body as ErrorResponse).errorCode).toBe('AUTH_CHALLENGE_EXPIRED');
  });

  it('finish with a wrong-origin attestation -> 401 AUTH_PASSKEY_VERIFICATION_FAILED', async () => {
    const passkey = createSoftwarePasskey();
    const attestationResponse = await begin('org@example.com', passkey, 'https://evil.example.com');
    const res = await request(server)
      .post(FINISH)
      .send({ email: 'org@example.com', attestationResponse })
      .expect(401);
    expect((res.body as ErrorResponse).errorCode).toBe('AUTH_PASSKEY_VERIFICATION_FAILED');
  });

  it('finish with malformed clientDataJSON -> 401 (not 500)', async () => {
    const passkey = createSoftwarePasskey();
    const attestationResponse = await begin('mal@example.com', passkey);
    attestationResponse.response.clientDataJSON = Buffer.from('not-json').toString('base64url');
    const res = await request(server)
      .post(FINISH)
      .send({ email: 'mal@example.com', attestationResponse })
      .expect(401);
    expect((res.body as ErrorResponse).errorCode).toBe('AUTH_PASSKEY_VERIFICATION_FAILED');
  });

  it('deploy failure -> 503 WALLET_DEPLOY_FAILED, then retry succeeds', async () => {
    const passkey = createSoftwarePasskey();
    const attestationResponse = await begin('deploy@example.com', passkey);

    relayer.failNext();
    const fail = await request(server)
      .post(FINISH)
      .send({ email: 'deploy@example.com', attestationResponse })
      .expect(503);
    expect((fail.body as ErrorResponse).errorCode).toBe('WALLET_DEPLOY_FAILED');

    await request(server)
      .post(FINISH)
      .send({ email: 'deploy@example.com', attestationResponse })
      .expect(201);
  });

  it('idempotent replay: re-submitting a completed registration returns 201 tokens', async () => {
    const passkey = createSoftwarePasskey();
    const attestationResponse = await begin('replay@example.com', passkey);
    const first = await request(server)
      .post(FINISH)
      .send({ email: 'replay@example.com', attestationResponse })
      .expect(201);
    const res = await request(server)
      .post(FINISH)
      .send({ email: 'replay@example.com', attestationResponse })
      .expect(201);
    expect((res.body as TokenResponse).accessToken).toBeTruthy();
    // refreshToken is always present on a 201 (a BFF copies it) — on replay too.
    expect((res.body as TokenResponse).refreshToken).toBeTruthy();
    // replay returns the SAME deployed wallet address as the original 201.
    expect((res.body as TokenResponse).contractAddress).toBe((first.body as TokenResponse).contractAddress);
    const wallets = await query<{ id: string }>(`SELECT id FROM wallets`);
    expect(wallets).toHaveLength(1);
  });
});
