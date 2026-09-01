import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as bcrypt from 'bcrypt';
import { StrKey } from '@stellar/stellar-sdk';
import { ThrottlerStorage } from '@nestjs/throttler';
import { AppModule } from '../../src/app.module';
import { truncateTables, noOpThrottlerStorage } from '../shared/helpers';
import { KYC_ALLOWLIST_TX_SERVICE } from '../../src/modules/kyc-allowlist/kyc-allowlist-tx.service.interface';
import { FakeKycAllowlistService } from '../shared/fake-kyc-allowlist';

interface ItemResult {
  wallet: string;
  action: string;
  status: string;
  isAllowed: boolean | null;
  txHash: string | null;
  errorReason: string | null;
}
interface Body {
  results?: ItemResult[];
  errorCode?: string;
}

const contract = (n: number): string => StrKey.encodeContract(Buffer.alloc(32, n));
const W1 = contract(1);
const W2 = contract(2);

/** NOTE: requires the local `tove_test` DB (migrated) + Redis. The tx port is faked (no testnet). */
describe('KYC Allowlist (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: object;
  const fake = new FakeKycAllowlistService();

  const adminEmail = 'kyc-allowlist-admin@example.com';
  const superEmail = 'kyc-allowlist-super@example.com';
  const password = 'SuperAdmin1!@#';

  async function seedAdmins(): Promise<void> {
    const passwordHash = await bcrypt.hash(password, 12);
    await dataSource.query(
      `INSERT INTO "admins" ("id","email","password_hash","role","is_active","created_at","updated_at")
       VALUES (gen_random_uuid(), $1, $2, 'admin', true, now(), now()),
              (gen_random_uuid(), $3, $2, 'superadmin', true, now(), now())
       ON CONFLICT ("email") WHERE "deleted_at" IS NULL DO NOTHING`,
      [adminEmail, passwordHash, superEmail],
    );
  }

  const loginAs = async (email: string): Promise<string> => {
    const res = await request(server)
      .post('/api/backoffice/v1/auth/login')
      .send({ email, password });
    return (res.body as { accessToken: string }).accessToken;
  };
  const login = () => loginAs(adminEmail);
  const loginSuper = () => loginAs(superEmail);

  const post = (token?: string, key: string | null = 'k1', body: unknown = { items: [{ wallet: W1, action: 'add' }] }) => {
    const req = request(server).post('/api/backoffice/v1/kyc/allowlist');
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noOpThrottlerStorage)
      .overrideProvider(KYC_ALLOWLIST_TX_SERVICE)
      .useValue(fake)
      .compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    server = app.getHttpServer() as object;
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
    fake.reset();
    await seedAdmins();
  });

  // --- authz / validation ---
  it('rejects an unauthenticated request with 401', async () => {
    await post(undefined).expect(401);
  });

  it('rejects a missing Idempotency-Key with 400', async () => {
    const token = await login();
    await post(token, null).expect(400);
  });

  it('rejects an empty items array with 400', async () => {
    const token = await login();
    await post(token, 'k-empty', { items: [] }).expect(400);
  });

  it('accepts a BYOW classic account (G…) add by SUPERADMIN and confirms it on-chain (TOV-243)', async () => {
    const token = await loginSuper();
    const G = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
    const res = await post(token, 'k-g-add', { items: [{ wallet: G, action: 'add' }] }).expect(200);
    const item = (res.body as Body).results?.[0];
    expect(item?.wallet).toBe(G);
    expect(item?.status).toBe('confirmed');
    expect(item?.isAllowed).toBe(true);
  });

  it('rejects a BYOW G-address add by a non-superadmin (ADMIN) → 403 (TOV-243 #438)', async () => {
    const token = await login();
    const G = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
    await post(token, 'k-g-admin', { items: [{ wallet: G, action: 'add' }] }).expect(403);
  });

  it('rejects a muxed (M) address with 400 (only plain account/contract are allowed)', async () => {
    const token = await login();
    const M = 'MB3KJPLFUYN5VL6R3GU3EGCGVCKFDSD7BEDX42HWG5BWFKB3KQGJIAAAAAAAAAAAAHKSA';
    await post(token, 'k-bad', { items: [{ wallet: M, action: 'add' }] }).expect(400);
  });

  it('rejects a batch over the configured maxBatch (default 5) with 422', async () => {
    const token = await login();
    const items = Array.from({ length: 6 }, (_, i) => ({ wallet: contract(i + 1), action: 'add' }));
    await post(token, 'k-cap', { items }).expect(422);
  });

  // --- happy paths (AC) ---
  it('add: fresh wallet → 200 confirmed, mirror is_allowed=true, event row with tx_hash', async () => {
    const token = await login();
    const res = await post(token, 'k-add', { items: [{ wallet: W1, action: 'add', reason: 'kyc_passed' }] }).expect(200);
    const body = res.body as Body;
    expect(body.results?.[0]).toMatchObject({ wallet: W1, action: 'add', status: 'confirmed', isAllowed: true });
    expect(body.results?.[0].txHash).toMatch(/^[0-9a-f]{64}$/);

    const stateRows = await dataSource.query<{ is_allowed: boolean }[]>(`SELECT is_allowed FROM kyc_allowlist_state WHERE wallet=$1`, [W1]);
    expect(stateRows[0]?.is_allowed).toBe(true);
    const eventRows = await dataSource.query<{ result: string; tx_hash: string }[]>(`SELECT result, tx_hash FROM kyc_allowlist_events WHERE wallet=$1`, [W1]);
    expect(eventRows[0]).toMatchObject({ result: 'confirmed' });
    expect(eventRows[0].tx_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('remove by ADMIN (not superadmin) → 403 (todo 228)', async () => {
    fake.setAllowed(W1);
    const token = await login();
    const res = await post(token, 'k-rm-403', { items: [{ wallet: W1, action: 'remove' }] }).expect(403);
    expect((res.body as Body).errorCode).toBe('FORBIDDEN');
  });

  it('remove: allowed wallet by SUPERADMIN → 200 confirmed, mirror is_allowed=false', async () => {
    fake.setAllowed(W1);
    const token = await loginSuper();
    const res = await post(token, 'k-rm', { items: [{ wallet: W1, action: 'remove' }] }).expect(200);
    expect((res.body as Body).results?.[0]).toMatchObject({ status: 'confirmed', isAllowed: false });
    const stateRows = await dataSource.query<{ is_allowed: boolean }[]>(`SELECT is_allowed FROM kyc_allowlist_state WHERE wallet=$1`, [W1]);
    expect(stateRows[0]?.is_allowed).toBe(false);
  });

  it('mixed batch → 200 with per-item confirmed + noop', async () => {
    fake.setAllowed(W2); // add W2 is a no-op
    const token = await login();
    const res = await post(token, 'k-mix', { items: [{ wallet: W1, action: 'add' }, { wallet: W2, action: 'add' }] }).expect(200);
    const byWallet = Object.fromEntries((res.body as Body).results!.map((r) => [r.wallet, r.status]));
    expect(byWallet[W1]).toBe('confirmed');
    expect(byWallet[W2]).toBe('noop');
  });

  // --- edge ---
  it('all-noop batch → 409 KYC_ALLOWLIST_ALL_NOOP', async () => {
    fake.setAllowed(W1);
    const token = await login();
    const res = await post(token, 'k-noop', { items: [{ wallet: W1, action: 'add' }] }).expect(409);
    expect((res.body as Body).errorCode).toBe('KYC_ALLOWLIST_ALL_NOOP');
  });

  it('same Idempotency-Key replays the stored body with no second submission', async () => {
    const token = await login();
    const first = (await post(token, 'k-replay', { items: [{ wallet: W1, action: 'add' }] }).expect(200)).body as Body;
    const replay = (await post(token, 'k-replay', { items: [{ wallet: W1, action: 'add' }] }).expect(200)).body as Body;
    expect(replay).toEqual(first);
    expect(fake.submitCalls).toHaveLength(1); // no second on-chain submit
  });

  it('same Idempotency-Key with a different batch → 422', async () => {
    const token = await login();
    await post(token, 'k-mismatch', { items: [{ wallet: W1, action: 'add' }] }).expect(200);
    await post(token, 'k-mismatch', { items: [{ wallet: W2, action: 'add' }] }).expect(422);
  });

  // --- GET :wallet status read (TOV-241) ---
  const getStatus = (token: string | undefined, wallet: string) => {
    const req = request(server).get(`/api/backoffice/v1/kyc/allowlist/${wallet}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req;
  };
  interface StatusBody {
    wallet?: string;
    isAllowed?: boolean;
    lastAction?: string | null;
    lastTxHash?: string | null;
    lastLedger?: string | null;
    updatedAt?: string | null;
    errorCode?: string;
  }

  it('GET allowed wallet → 200 { isAllowed:true } with provenance + Cache-Control: no-store', async () => {
    const token = await login();
    await post(token, 'k-get-add', { items: [{ wallet: W1, action: 'add', reason: 'kyc_passed' }] }).expect(200);
    const res = await getStatus(token, W1).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.body as StatusBody;
    expect(body).toMatchObject({ wallet: W1, isAllowed: true, lastAction: 'add' });
    expect(body.lastTxHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.updatedAt).not.toBeNull();
  });

  it('GET never-seen wallet → 200 { isAllowed:false } (NOT 404), provenance all null', async () => {
    const token = await login();
    const res = await getStatus(token, contract(9));
    expect(res.status).toBe(200); // headline AC: never 404 for "not on the list"
    expect(res.body as StatusBody).toEqual({
      wallet: contract(9),
      isAllowed: false,
      lastAction: null,
      lastTxHash: null,
      lastLedger: null,
      updatedAt: null,
    });
  });

  it('GET writes a kyc.allowlist.read audit row (actor=admin, wallet in payload) (todo 267)', async () => {
    const token = await login();
    await getStatus(token, contract(9)).expect(200);
    const rows = await dataSource.query<{ actor_type: string; payload: { wallet: string } }[]>(
      `SELECT actor_type, payload FROM internal_audit_log WHERE kind='kyc.allowlist.read' AND subject_type='kyc_allowlist_wallet'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_type).toBe('admin');
    expect(rows[0].payload.wallet).toBe(contract(9));
  });

  it('GET removed wallet → 200 { isAllowed:false, lastAction:"remove" } (distinct from never-seen)', async () => {
    const admin = await login();
    await post(admin, 'k-get-rm-add', { items: [{ wallet: W1, action: 'add' }] }).expect(200);
    const superToken = await loginSuper();
    await post(superToken, 'k-get-rm', { items: [{ wallet: W1, action: 'remove' }] }).expect(200);
    const body = (await getStatus(admin, W1).expect(200)).body as StatusBody;
    expect(body.isAllowed).toBe(false);
    expect(body.lastAction).toBe('remove');
  });

  it('GET a never-seen BYOW account (G…) → 200 { isAllowed:false } (TOV-243, not 400/404)', async () => {
    const token = await login();
    const G = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
    const res = await getStatus(token, G).expect(200);
    const body = res.body as StatusBody;
    expect(body.wallet).toBe(G);
    expect(body.isAllowed).toBe(false);
  });

  it('GET a malformed wallet (muxed M…) → 400 VALIDATION_FAILED (not 404/500)', async () => {
    const token = await login();
    const M = 'MB3KJPLFUYN5VL6R3GU3EGCGVCKFDSD7BEDX42HWG5BWFKB3KQGJIAAAAAAAAAAAAHKSA';
    const res = await getStatus(token, M).expect(400);
    expect((res.body as StatusBody).errorCode).toBe('VALIDATION_FAILED');
  });

  it('GET unauthenticated → 401', async () => {
    await getStatus(undefined, W1).expect(401);
  });

  it('GET by ADMIN → 200 and by SUPERADMIN → 200 (both read; no 403 path)', async () => {
    const admin = await login();
    await post(admin, 'k-get-roles', { items: [{ wallet: W1, action: 'add' }] }).expect(200);
    await getStatus(admin, W1).expect(200);
    await getStatus(await loginSuper(), W1).expect(200);
  });
});
