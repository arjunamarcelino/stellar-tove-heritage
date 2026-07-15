import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Server } from 'node:http';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { AppModule } from '../../src/app.module';
import { IdempotencyStore } from '../../src/common/idempotency/idempotency-store';
import { truncateTables, noOpThrottlerStorage } from '../shared/helpers';
import { InMemoryIdempotencyStore } from '../shared/in-memory-idempotency-store';

interface ChallengeResponse {
  challengeTxXdr: string;
  networkPassphrase: string;
}
interface MeWallet {
  id: string;
  kind: string;
  publicKey: string | null;
  isPrimary: boolean;
}

describe('me/wallets multi-wallet binding (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Server;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerStorage)
      .useValue(noOpThrottlerStorage)
      .overrideProvider(IdempotencyStore)
      .useValue(new InMemoryIdempotencyStore())
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    dataSource = app.get(DataSource);
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await truncateTables(dataSource);
  });

  function sign(challenge: ChallengeResponse, kp: Keypair): string {
    const tx = TransactionBuilder.fromXDR(challenge.challengeTxXdr, challenge.networkPassphrase);
    tx.sign(kp);
    return tx.toEnvelope().toXDR('base64');
  }

  /** Authenticate a fresh Collector via SEP-10 login; returns the access token + login keypair. */
  async function login(): Promise<{ token: string; kp: Keypair }> {
    const kp = Keypair.random();
    const challenge = await request(server).post('/api/v1/auth/sep10/challenge').send({ publicKey: kp.publicKey() });
    const verify = await request(server)
      .post('/api/v1/auth/sep10/verify')
      .send({ challengeTxXdr: sign(challenge.body as ChallengeResponse, kp) });
    return { token: (verify.body as { accessToken: string }).accessToken, kp };
  }

  /** Request a user-bound challenge for `kp` and return the signed XDR ready to POST. */
  async function signedBindChallenge(token: string, kp: Keypair): Promise<string> {
    const res = await request(server)
      .post('/api/v1/me/wallets/challenge')
      .set('Authorization', `Bearer ${token}`)
      .send({ publicKey: kp.publicKey() });
    expect(res.status).toBe(200);
    return sign(res.body as ChallengeResponse, kp);
  }

  function addWallet(token: string, signedChallengeXdr: string, idemKey = 'idem-1') {
    return request(server)
      .post('/api/v1/me/wallets')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idemKey)
      .send({ signedChallengeXdr });
  }

  function listWallets(token: string) {
    return request(server).get('/api/v1/me/wallets').set('Authorization', `Bearer ${token}`);
  }

  function setPrimary(token: string, walletId: string) {
    return request(server)
      .post(`/api/v1/me/wallets/${walletId}/primary`)
      .set('Authorization', `Bearer ${token}`);
  }

  function deleteWallet(token: string, walletId: string) {
    return request(server)
      .delete(`/api/v1/me/wallets/${walletId}`)
      .set('Authorization', `Bearer ${token}`);
  }

  /** The caller's single primary wallet id (asserts exactly one primary). */
  async function primaryId(token: string): Promise<string> {
    const wallets = (await listWallets(token)).body as MeWallet[];
    const primaries = wallets.filter((w) => w.isPrimary);
    expect(primaries).toHaveLength(1);
    return primaries[0].id;
  }

  it('adds a second BYOW wallet and lists both with correct primary flags', async () => {
    const { token } = await login(); // login wallet is the primary
    const kp2 = Keypair.random();

    const add = await addWallet(token, await signedBindChallenge(token, kp2));
    expect(add.status).toBe(201);
    expect((add.body as MeWallet).isPrimary).toBe(false);

    const list = await listWallets(token);
    expect(list.status).toBe(200);
    const wallets = list.body as MeWallet[];
    expect(wallets).toHaveLength(2);
    expect(wallets.filter((w) => w.isPrimary)).toHaveLength(1);
    expect(wallets.find((w) => w.publicKey === kp2.publicKey())?.isPrimary).toBe(false);
  });

  it('rejects binding a pubkey already bound to another Collector (409 WALLET_ALREADY_BOUND)', async () => {
    const a = await login(); // a.kp is bound to collector A
    const b = await login();

    // Collector B proves possession of A's pubkey (we hold the secret) but it is already bound to A.
    const signed = await signedBindChallenge(b.token, a.kp);
    const res = await addWallet(b.token, signed);
    expect(res.status).toBe(409);
    expect((res.body as { errorCode: string }).errorCode).toBe('WALLET_ALREADY_BOUND');
  });

  it('rejects a signed anonymous (login) challenge at the bind endpoint (401)', async () => {
    const { token } = await login();
    const kp2 = Keypair.random();
    // An ANONYMOUS login challenge (user_id NULL) must not be usable to bind.
    const anon = await request(server).post('/api/v1/auth/sep10/challenge').send({ publicKey: kp2.publicKey() });
    const res = await addWallet(token, sign(anon.body as ChallengeResponse, kp2));
    expect(res.status).toBe(401);
    expect((res.body as { errorCode: string }).errorCode).toBe('AUTH_SIGNATURE_INVALID');
  });

  it('replays the same Idempotency-Key + body without creating a second row', async () => {
    const { token } = await login();
    const kp2 = Keypair.random();
    const signed = await signedBindChallenge(token, kp2);

    const first = await addWallet(token, signed, 'dup-key');
    expect(first.status).toBe(201);
    // Same key + same body → replay the original 201 (the challenge is single-use; without idempotency
    // this would surface a confusing ALREADY_USED).
    const replay = await addWallet(token, signed, 'dup-key');
    expect(replay.status).toBe(201);
    expect((replay.body as MeWallet).id).toBe((first.body as MeWallet).id);

    const list = await listWallets(token);
    expect((list.body as MeWallet[])).toHaveLength(2);
  });

  it('rejects the same Idempotency-Key reused with a different body (422 MISMATCH)', async () => {
    const { token } = await login();
    const firstBody = await signedBindChallenge(token, Keypair.random());
    expect((await addWallet(token, firstBody, 'reuse-key')).status).toBe(201);

    // Same key, DIFFERENT signed challenge → 422 (not a replay).
    const otherBody = await signedBindChallenge(token, Keypair.random());
    const res = await addWallet(token, otherBody, 'reuse-key');
    expect(res.status).toBe(422);
    expect((res.body as { errorCode: string }).errorCode).toBe('IDEMPOTENCY_KEY_MISMATCH');
  });

  it('requires the Idempotency-Key header (400 when missing)', async () => {
    const { token } = await login();
    const kp2 = Keypair.random();
    const signed = await signedBindChallenge(token, kp2);
    const res = await request(server)
      .post('/api/v1/me/wallets')
      .set('Authorization', `Bearer ${token}`)
      .send({ signedChallengeXdr: signed });
    expect(res.status).toBe(400);
  });

  it('removes a non-primary wallet (204) but refuses the sole primary (409)', async () => {
    const { token } = await login();
    const kp2 = Keypair.random();
    const add = await addWallet(token, await signedBindChallenge(token, kp2));
    const secondaryId = (add.body as MeWallet).id;

    const del = await deleteWallet(token, secondaryId);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ deletedId: secondaryId, newPrimaryWalletId: null }); // non-primary: unchanged
    expect((await listWallets(token)).body as MeWallet[]).toHaveLength(1);

    // The remaining wallet is the sole primary → no sibling to promote → refused.
    const delPrimary = await deleteWallet(token, await primaryId(token));
    expect(delPrimary.status).toBe(409);
    expect((delPrimary.body as { errorCode: string }).errorCode).toBe('PRIMARY_WALLET_CANNOT_BE_REMOVED');
  });

  it('sets a second wallet as primary (200) and flips the primary flag', async () => {
    const { token } = await login(); // login wallet W1 is primary
    const kp2 = Keypair.random();
    const w1 = await primaryId(token);
    const w2 = (await addWallet(token, await signedBindChallenge(token, kp2))).body as MeWallet;
    expect(w2.isPrimary).toBe(false);

    const res = await setPrimary(token, w2.id);
    expect(res.status).toBe(200);
    expect((res.body as MeWallet).isPrimary).toBe(true);

    const wallets = (await listWallets(token)).body as MeWallet[];
    expect(wallets.filter((w) => w.isPrimary)).toHaveLength(1);
    expect(wallets.find((w) => w.id === w2.id)?.isPrimary).toBe(true);
    expect(wallets.find((w) => w.id === w1)?.isPrimary).toBe(false);
  });

  it('re-setting the current primary is an idempotent 200 no-op', async () => {
    const { token } = await login();
    const w1 = await primaryId(token);
    const res = await setPrimary(token, w1);
    expect(res.status).toBe(200);
    expect((res.body as MeWallet).isPrimary).toBe(true);
    expect(await primaryId(token)).toBe(w1); // still the single primary
  });

  it('auto-promotes a sibling when deleting the primary (200 + new primary id)', async () => {
    const { token } = await login(); // W1 primary
    const w1 = await primaryId(token);
    const w2 = (await addWallet(token, await signedBindChallenge(token, Keypair.random()))).body as MeWallet;

    const del = await deleteWallet(token, w1);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ deletedId: w1, newPrimaryWalletId: w2.id }); // caller learns the new settlement wallet

    const wallets = (await listWallets(token)).body as MeWallet[];
    expect(wallets).toHaveLength(1);
    expect(wallets[0].id).toBe(w2.id);
    expect(wallets[0].isPrimary).toBe(true); // sibling auto-promoted
  });

  it('returns 404 setting a wallet owned by another Collector as primary', async () => {
    const a = await login();
    const b = await login();
    const aWalletId = (await addWallet(a.token, await signedBindChallenge(a.token, Keypair.random())))
      .body as MeWallet;

    const res = await setPrimary(b.token, aWalletId.id);
    expect(res.status).toBe(404);
    expect((res.body as { errorCode: string }).errorCode).toBe('WALLET_NOT_FOUND');
  });

  it('returns 404 when deleting a wallet owned by another Collector', async () => {
    const a = await login();
    const b = await login();
    const add = await addWallet(a.token, await signedBindChallenge(a.token, Keypair.random()));
    const aWalletId = (add.body as MeWallet).id;

    const res = await request(server)
      .delete(`/api/v1/me/wallets/${aWalletId}`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated access (401)', async () => {
    expect((await request(server).get('/api/v1/me/wallets')).status).toBe(401);
    expect(
      (await request(server).post('/api/v1/me/wallets/challenge').send({ publicKey: Keypair.random().publicKey() }))
        .status,
    ).toBe(401);
    // Set-primary is owner-scoped behind the global AuthGuard (uuid shape is valid; auth runs first).
    expect(
      (await request(server).post('/api/v1/me/wallets/00000000-0000-4000-8000-000000000000/primary')).status,
    ).toBe(401);
  });
});
