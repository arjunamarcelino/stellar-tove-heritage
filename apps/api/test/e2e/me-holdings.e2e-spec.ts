import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Server } from 'node:http';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { AppModule } from '../../src/app.module';
import { truncateTables, noOpThrottlerStorage } from '../shared/helpers';
import { FRACTION_READ_SERVICE } from '../../src/modules/fractionalization/fraction-read.service.interface';
import { FakeFractionReadService } from '../shared/fake-fraction-read';
import { FractionReadUnavailableError } from '../../src/modules/fractionalization/fraction-read.errors';

interface Holding {
  artworkId: string;
  artworkTitle: string;
  artworkSlug: string;
  artworkImageUrl: string | null;
  tokenContract: string;
  balance: string;
  lockedBalance: string;
  freeBalance: string;
  artistHandle: string | null;
}

interface ChallengeResponse {
  challengeTxXdr: string;
  networkPassphrase: string;
}

/**
 * NOTE: requires the local `tove_test` DB (migrated: `yarn db:test:setup`) + Redis. The balance-read port
 * is overridden with a deterministic fake, so no testnet is touched; the 30s cache uses the real Redis.
 */
describe('me/holdings (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Server;
  const fakeRead = new FakeFractionReadService();

  const ARTIST_ID = '00000000-0000-4000-8000-0000000e0001';
  const ARTWORK_ID = '00000000-0000-4000-8000-0000000e0010';
  const ARTIST_ADDRESS = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
  const TOKEN = 'C'.repeat(56);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noOpThrottlerStorage)
      .overrideProvider(FRACTION_READ_SERVICE)
      .useValue(fakeRead)
      .compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    server = app.getHttpServer() as Server;
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
    fakeRead.reset();
  });

  function sign(challenge: ChallengeResponse, kp: Keypair): string {
    const tx = TransactionBuilder.fromXDR(challenge.challengeTxXdr, challenge.networkPassphrase);
    tx.sign(kp);
    return tx.toEnvelope().toXDR('base64');
  }

  /** SEP-10 login → collector JWT; the login wallet is auto-set as the primary settlement wallet. */
  async function login(): Promise<string> {
    const kp = Keypair.random();
    const challenge = await request(server)
      .post('/api/v1/auth/sep10/challenge')
      .send({ publicKey: kp.publicKey() });
    const verify = await request(server)
      .post('/api/v1/auth/sep10/verify')
      .send({ challengeTxXdr: sign(challenge.body as ChallengeResponse, kp) });
    return (verify.body as { accessToken: string }).accessToken;
  }

  /** Seed one `deployed` fraction contract (owned artist ≠ caller, so the caller is a collector). */
  async function seedDeployedContract(): Promise<void> {
    await dataSource.query(
      `INSERT INTO "users" ("id","email","password_hash","is_active") VALUES ($1, NULL, NULL, true)
       ON CONFLICT ("id") DO NOTHING`,
      [ARTIST_ID],
    );
    await dataSource.query(
      `INSERT INTO "artworks" ("id","status","artist_user_id","title","artist_handle","primary_image_url")
       VALUES ($1,'fractionalized',$2,'Northern Lights','sophie-tove','https://cdn.tove.test/aw.jpg')
       ON CONFLICT ("id") DO NOTHING`,
      [ARTWORK_ID, ARTIST_ID],
    );
    await dataSource.query(
      `INSERT INTO "fraction_contracts"
        ("id","artwork_id","status","token_address","wasm_hash","token_name","token_symbol",
         "artist_address","total_supply","artist_retention_pct","treasury_retention_pct",
         "artist_lockup_days","treasury_lockup_days")
       VALUES (gen_random_uuid(),$1,'deployed',$2,$3,'Northern Lights','NLIGHT',$4,'1000000',10,5,365,730)`,
      [ARTWORK_ID, TOKEN, 'a'.repeat(64), ARTIST_ADDRESS],
    );
  }

  const get = (token?: string) => {
    const req = request(server).get('/api/v1/me/holdings');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req;
  };

  it('rejects an unauthenticated request with 401', async () => {
    await get().expect(401);
  });

  it('returns 200 [] for an authenticated caller with no deployed contracts', async () => {
    const token = await login();
    const res = await get(token).expect(200);
    expect(res.body).toEqual([]);
  });

  it('returns the caller holdings with derived slug and free balance', async () => {
    const token = await login();
    await seedDeployedContract();
    fakeRead.balances.set(TOKEN, '60');

    const res = await get(token).expect(200);
    const body = res.body as Holding[];
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      artworkId: ARTWORK_ID,
      artworkTitle: 'Northern Lights',
      tokenContract: TOKEN,
      balance: '60',
      lockedBalance: '0',
      freeBalance: '60',
      artistHandle: 'sophie-tove',
    });
    expect(body[0].artworkSlug).toMatch(/^northern-lights-[0-9a-f]{8}$/);
  });

  it('serves a second call from the 30s cache (read port hit once)', async () => {
    const token = await login();
    await seedDeployedContract();
    fakeRead.balances.set(TOKEN, '42');

    const first = await get(token).expect(200);
    const second = await get(token).expect(200);
    expect(second.body).toEqual(first.body);
    expect(fakeRead.calls).toBe(1); // second request hit the cache
  });

  it('returns 503 HOLDINGS_UNAVAILABLE (generic body, no token leak) when a balance read fails', async () => {
    const token = await login();
    await seedDeployedContract();
    fakeRead.error = new FractionReadUnavailableError('balance read unavailable');

    const res = await get(token).expect(503);
    const body = res.body as { errorCode: string; message: string };
    expect(body.errorCode).toBe('HOLDINGS_UNAVAILABLE');
    expect(body.message).toBe('Holdings are temporarily unavailable');
    expect(JSON.stringify(body)).not.toContain(TOKEN); // no token address leaks to the client
  });
});
