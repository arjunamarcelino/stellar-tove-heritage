// Enumerate a fraction token (address:symbol:decimals) so an export produces USDC + fraction items.
// Read before AppModule loads so relayerConfig picks it up.
process.env.RELAYER_FRACTION_TOKENS = 'CDL5YRUNMPGJ42KQFDEKTJBTVBAQGKAGQRJ44DRFBJSMZMBBTACGAQYI:ART:0';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { Keypair } from '@stellar/stellar-sdk';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AppModule } from '../../src/app.module';
import { RELAYER_SERVICE } from '../../src/modules/relayer/relayer.service.interface';
import { noOpThrottlerStorage } from '../shared/helpers';
import { FakeRelayerService } from '../shared/fake-relayer';
import { createSoftwarePasskey, buildAttestation, signAssertion, type SoftwarePasskey } from '../shared/webauthn-authenticator';

const BEGIN = '/api/v1/auth/passkey/register/begin';
const FINISH = '/api/v1/auth/passkey/register/finish';
const RP_ID = 'tove.io';
const ORIGIN = 'https://tove.io';
const USDC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const FRACTION = 'CDL5YRUNMPGJ42KQFDEKTJBTVBAQGKAGQRJ44DRFBJSMZMBBTACGAQYI';
const TARGET = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

interface FinishResponse {
  accessToken: string;
  contractAddress: string;
}
interface RegisteredUser extends FinishResponse {
  passkey: SoftwarePasskey;
  walletId: string;
  userId: string;
}
interface ExportItem {
  itemId: string;
  tokenContract: string;
  tokenKind: string;
  decimals: number;
  assetCode: string;
  displayName: string;
  challenge: string;
}
interface ExportResponse {
  exportId: string;
  items: ExportItem[];
}

describe('Wallet export (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: object;
  const relayer = new FakeRelayerService();

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

  async function registerUser(email: string): Promise<RegisteredUser> {
    const passkey = createSoftwarePasskey();
    const begin = await request(server).post(BEGIN).send({ email }).expect(200);
    const attestationResponse = buildAttestation({
      passkey,
      challenge: (begin.body as { options: { challenge: string } }).options.challenge,
      rpId: RP_ID,
      origin: ORIGIN,
    });
    const finish = await request(server).post(FINISH).send({ email, attestationResponse }).expect(201);
    const body = finish.body as FinishResponse;
    const rows = await rawQuery<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM wallets WHERE contract_address = $1',
      [body.contractAddress],
    );
    return { ...body, passkey, walletId: rows[0].id, userId: rows[0].user_id };
  }

  async function rawQuery<T>(text: string, params: unknown[] = []): Promise<T[]> {
    const rows = (await dataSource.query(text, params)) as unknown;
    return rows as T[];
  }

  async function allow(target: string): Promise<void> {
    await rawQuery('INSERT INTO fraction_kyc_allowlist (target_address) VALUES ($1)', [target]);
  }

  async function initiate(u: RegisteredUser): Promise<ExportResponse> {
    const res = await request(server)
      .post(`/api/v1/me/wallets/${u.walletId}/export`)
      .set('Authorization', `Bearer ${u.accessToken}`)
      .send({ targetAddress: TARGET })
      .expect(200);
    return res.body as ExportResponse;
  }

  it('exports an embedded wallet end-to-end (USDC + fraction), latching it exported', async () => {
    const u = await registerUser('export-happy@example.com');
    await allow(TARGET);
    relayer.setHolding(u.contractAddress, USDC, '1000000');
    relayer.setHolding(u.contractAddress, FRACTION, '5');

    const built = await initiate(u);
    expect(built.items).toHaveLength(2);
    expect(built.items.map((i) => i.tokenKind).sort()).toEqual(['fraction', 'usdc']);
    // Display metadata for the confirm screen.
    const usdcItem = built.items.find((i) => i.tokenKind === 'usdc')!;
    const fracItem = built.items.find((i) => i.tokenKind === 'fraction')!;
    expect(usdcItem.decimals).toBe(7);
    expect(usdcItem.assetCode).toBe('USDC');
    expect(fracItem.decimals).toBe(0);
    expect(fracItem.assetCode).toBe('ART');

    const items = built.items.map((it) => ({
      itemId: it.itemId,
      ...signAssertion({ passkey: u.passkey, challenge: it.challenge, rpId: RP_ID, origin: ORIGIN }),
    }));
    const submit = await request(server)
      .post(`/api/v1/me/wallets/${u.walletId}/export/submit`)
      .set('Authorization', `Bearer ${u.accessToken}`)
      .send({ exportId: built.exportId, items })
      .expect(200);

    const body = submit.body as { status: string; walletExported: boolean };
    expect(body.status).toBe('completed');
    expect(body.walletExported).toBe(true);

    const w = await rawQuery<{ status: string; removed_at: string | null }>(
      'SELECT status, removed_at FROM wallets WHERE id = $1',
      [u.walletId],
    );
    expect(w[0].status).toBe('exported');
    expect(w[0].removed_at).not.toBeNull();

    // Per-item audit rows (todo 142): one confirmed row per holding, subject = the export item.
    const itemAudits = await rawQuery<{ count: string }>(
      "SELECT COUNT(*) AS count FROM internal_audit_log WHERE subject_type='wallet_export_item' AND kind='wallet.export.confirmed'",
    );
    expect(Number(itemAudits[0].count)).toBe(2);
    // The export-level confirm is a user actor (not 'system').
    const latch = await rawQuery<{ actor_type: string }>(
      "SELECT actor_type FROM internal_audit_log WHERE subject_type='wallet_export' AND kind='wallet.export.confirmed'",
    );
    expect(latch[0].actor_type).toBe('user');

    // status endpoint reflects the confirmed export
    const status = await request(server)
      .get(`/api/v1/me/wallets/${u.walletId}/export/status`)
      .set('Authorization', `Bearer ${u.accessToken}`)
      .expect(200);
    expect((status.body as { state: string }).state).toBe('confirmed');

    // already-exported: a further initiate is rejected with 409 ALREADY_EXPORTED (distinct from 422)
    const reexport = await request(server)
      .post(`/api/v1/me/wallets/${u.walletId}/export`)
      .set('Authorization', `Bearer ${u.accessToken}`)
      .send({ targetAddress: TARGET })
      .expect(409);
    expect((reexport.body as { errorCode: string }).errorCode).toBe('ALREADY_EXPORTED');

    // GET /me/wallets reflects the exported embedded wallet
    const list = await request(server)
      .get('/api/v1/me/wallets')
      .set('Authorization', `Bearer ${u.accessToken}`)
      .expect(200);
    const wallets = list.body as { id: string; kind: string; address: string; exported: boolean }[];
    const embedded = wallets.find((w) => w.id === u.walletId)!;
    expect(embedded.kind).toBe('embedded_passkey');
    expect(embedded.address).toBe(u.contractAddress);
    expect(embedded.exported).toBe(true);
  });

  it('rejects a target not on the KYC allowlist with 422 RECIPIENT_NOT_WHITELISTED', async () => {
    const u = await registerUser('export-nowl@example.com');
    relayer.setHolding(u.contractAddress, USDC, '1000000');
    const res = await request(server)
      .post(`/api/v1/me/wallets/${u.walletId}/export`)
      .set('Authorization', `Bearer ${u.accessToken}`)
      .send({ targetAddress: TARGET })
      .expect(422);
    expect((res.body as { errorCode: string }).errorCode).toBe('RECIPIENT_NOT_WHITELISTED');
  });

  it('rejects export from a BYOW wallet with 422 EXPORT_NOT_AVAILABLE', async () => {
    const u = await registerUser('export-byow@example.com');
    const byow = await rawQuery<{ id: string }>(
      "INSERT INTO wallets (user_id, public_key, kind, status) VALUES ($1, $2, 'byow', 'active') RETURNING id",
      [u.userId, Keypair.random().publicKey()],
    );
    await allow(TARGET);
    const res = await request(server)
      .post(`/api/v1/me/wallets/${byow[0].id}/export`)
      .set('Authorization', `Bearer ${u.accessToken}`)
      .send({ targetAddress: TARGET })
      .expect(422);
    expect((res.body as { errorCode: string }).errorCode).toBe('EXPORT_NOT_AVAILABLE');
  });

  it('rejects an empty wallet (no holdings) with 422 EXPORT_NOT_AVAILABLE', async () => {
    const u = await registerUser('export-empty@example.com');
    await allow(TARGET);
    const res = await request(server)
      .post(`/api/v1/me/wallets/${u.walletId}/export`)
      .set('Authorization', `Bearer ${u.accessToken}`)
      .send({ targetAddress: TARGET })
      .expect(422);
    expect((res.body as { errorCode: string }).errorCode).toBe('EXPORT_NOT_AVAILABLE');
  });

  it("rejects exporting another user's wallet with 404 WALLET_NOT_FOUND", async () => {
    const owner = await registerUser('export-owner@example.com');
    const other = await registerUser('export-attacker@example.com');
    await allow(TARGET);
    relayer.setHolding(owner.contractAddress, USDC, '1000000');
    await request(server)
      .post(`/api/v1/me/wallets/${owner.walletId}/export`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ targetAddress: TARGET })
      .expect(404);
  });

  it('fails an item whose assertion signs a different challenge (binding); wallet not exported', async () => {
    const u = await registerUser('export-badsig@example.com');
    await allow(TARGET);
    relayer.setHolding(u.contractAddress, USDC, '1000000');
    const built = await initiate(u);
    const items = built.items.map((it) => ({
      itemId: it.itemId,
      ...signAssertion({ passkey: u.passkey, challenge: Buffer.alloc(32, 9).toString('base64url'), rpId: RP_ID, origin: ORIGIN }),
    }));
    const submit = await request(server)
      .post(`/api/v1/me/wallets/${u.walletId}/export/submit`)
      .set('Authorization', `Bearer ${u.accessToken}`)
      .send({ exportId: built.exportId, items })
      .expect(200);
    const body = submit.body as { walletExported: boolean; items: { status: string; errorCode?: string }[] };
    expect(body.walletExported).toBe(false);
    expect(body.items[0].status).toBe('failed');
    expect(body.items[0].errorCode).toBe('TRANSFER_SIGNATURE_INVALID');
  });

  it('reconciles crash-stuck submitted items on status read and latches exported (todo 127)', async () => {
    const u = await registerUser('export-reconcile@example.com');
    await allow(TARGET);
    relayer.setHolding(u.contractAddress, USDC, '1000000');
    const built = await initiate(u);

    // Simulate a crash between on-chain success and the DB confirm: the item is stuck 'submitted' and
    // the token is actually drained on-chain (fake balance now 0).
    await rawQuery("UPDATE wallet_export_items SET status='submitted' WHERE id=$1", [built.items[0].itemId]);
    relayer.setHolding(u.contractAddress, USDC, '0');

    // The FE's reconciliation poll: status reconciles the drained item to confirmed and latches exported.
    const status = await request(server)
      .get(`/api/v1/me/wallets/${u.walletId}/export/status`)
      .set('Authorization', `Bearer ${u.accessToken}`)
      .expect(200);
    expect((status.body as { state: string }).state).toBe('confirmed');

    const w = await rawQuery<{ status: string; removed_at: string | null }>(
      'SELECT status, removed_at FROM wallets WHERE id = $1',
      [u.walletId],
    );
    expect(w[0].status).toBe('exported');
    expect(w[0].removed_at).not.toBeNull();
  });

  it('blocks submit when the target was revoked from the allowlist after initiate', async () => {
    const u = await registerUser('export-revoked@example.com');
    await allow(TARGET);
    relayer.setHolding(u.contractAddress, USDC, '1000000');
    const built = await initiate(u);
    // Compliance revokes the target (soft-delete) between initiate and submit.
    await rawQuery('UPDATE fraction_kyc_allowlist SET deleted_at=now() WHERE target_address=$1', [TARGET]);
    const items = built.items.map((it) => ({
      itemId: it.itemId,
      ...signAssertion({ passkey: u.passkey, challenge: it.challenge, rpId: RP_ID, origin: ORIGIN }),
    }));
    const res = await request(server)
      .post(`/api/v1/me/wallets/${u.walletId}/export/submit`)
      .set('Authorization', `Bearer ${u.accessToken}`)
      .send({ exportId: built.exportId, items })
      .expect(422);
    expect((res.body as { errorCode: string }).errorCode).toBe('RECIPIENT_NOT_WHITELISTED');
  });

  it('always pins expectedTo + expectedAmountScaled on every export submit (todo 136)', async () => {
    const before = relayer.submitCalls.length;
    const u = await registerUser('export-pins@example.com');
    await allow(TARGET);
    relayer.setHolding(u.contractAddress, USDC, '2500000');
    const built = await initiate(u);
    const items = built.items.map((it) => ({
      itemId: it.itemId,
      ...signAssertion({ passkey: u.passkey, challenge: it.challenge, rpId: RP_ID, origin: ORIGIN }),
    }));
    await request(server)
      .post(`/api/v1/me/wallets/${u.walletId}/export/submit`)
      .set('Authorization', `Bearer ${u.accessToken}`)
      .send({ exportId: built.exportId, items })
      .expect(200);

    // The export path must ALWAYS pin the recipient + exact amount to server-trusted values.
    const calls = relayer.submitCalls.slice(before);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.expectedTo).toBe(TARGET);
      expect(c.expectedAmountScaled).toBe('2500000');
    }
  });

  it('rejects an unauthenticated export with 401', async () => {
    await request(server)
      .post('/api/v1/me/wallets/00000000-0000-0000-0000-000000000000/export')
      .send({ targetAddress: TARGET })
      .expect(401);
  });
});
