import { randomUUID } from 'node:crypto';
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
const NOTIFS = '/api/v1/me/notifications';
const RP_ID = 'tove.io';
const ORIGIN = 'https://tove.io';
const CONTRACT_ADDR = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const ARTIST_ADDR = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
const WASM = '7ad8c08d6e4d72dafba21c1b27b8908e974d725a46aa354491185ae6f26947cd';

interface BeginResponse {
  options: { challenge: string };
}
interface FinishResponse {
  accessToken: string;
  contractAddress: string;
}
interface NotifItem {
  id: string;
  rfqId: string;
  artworkId: string;
  artworkTitle: string;
  artworkSlug: string;
  maxPricePerFractionStroops: string;
  fractionCount: string;
  rfqStatus: string;
  rfqExpiresAt: string;
  readAt: string | null;
  createdAt: string;
}
interface Paged {
  data: NotifItem[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

describe('Marketplace RFQ notifications inbox (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
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
    ds = app.get(DataSource);
    server = app.getHttpServer() as object;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    for (const entity of ds.entityMetadatas) {
      await ds.getRepository(entity.name).query(`TRUNCATE TABLE "${entity.tableName}" CASCADE`);
    }
  });

  async function registerUser(email: string): Promise<{ accessToken: string; sub: string }> {
    const passkey: SoftwarePasskey = createSoftwarePasskey();
    const begin = await request(server).post(BEGIN).send({ email }).expect(200);
    const attestationResponse = buildAttestation({
      passkey,
      challenge: (begin.body as BeginResponse).options.challenge,
      rpId: RP_ID,
      origin: ORIGIN,
    });
    const finish = await request(server).post(FINISH).send({ email, attestationResponse }).expect(201);
    const { accessToken, contractAddress } = finish.body as FinishResponse;
    const rows = await ds.query<{ user_id: string }[]>(
      `SELECT user_id FROM wallets WHERE contract_address=$1`,
      [contractAddress],
    );
    return { accessToken, sub: rows[0].user_id };
  }

  /** Seed artwork + deployed contract + an open RFQ; return the rfq + artwork ids. */
  async function seedRfq(title = 'Untitled No. 4'): Promise<{ rfqId: string; artworkId: string }> {
    const [{ id: artistId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO users (is_active, kyc_status) VALUES (true, 'not_submitted') RETURNING id`,
    );
    const [{ id: artworkId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO artworks (status, artist_user_id, title) VALUES ('fractionalized', $1, $2) RETURNING id`,
      [artistId, title],
    );
    const [{ id: contractId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO fraction_contracts (
         artwork_id, status, token_address, wasm_hash, token_name, token_symbol, artist_address,
         total_supply, artist_retention_pct, treasury_retention_pct,
         artist_retention_amount, treasury_retention_amount, artist_lockup_days, treasury_lockup_days
       ) VALUES ($1, 'deployed', $2, $3, 'ArtToken', 'ART', $4,
         '1000000', 10, 5, '100000', '50000', 365, 730) RETURNING id`,
      [artworkId, CONTRACT_ADDR, WASM, ARTIST_ADDR],
    );
    const [{ id: rfqId }] = await ds.query<{ id: string }[]>(
      `INSERT INTO rfqs (collector_sub, artwork_id, fraction_contract_id, fraction_count,
         max_price_per_fraction_stroops, expires_at, status, idempotency_key_hash)
       VALUES ($1,$2,$3,'100','150000000',$4,'open',$5) RETURNING id`,
      [randomUUID(), artworkId, contractId, new Date(Date.now() + 48 * 3_600_000), Buffer.alloc(32, 7)],
    );
    return { rfqId, artworkId };
  }

  async function seedNotification(rfqId: string, artworkId: string, recipientSub: string): Promise<string> {
    const [{ id }] = await ds.query<{ id: string }[]>(
      `INSERT INTO rfq_notifications (rfq_id, recipient_sub, artwork_id) VALUES ($1,$2,$3) RETURNING id`,
      [rfqId, recipientSub, artworkId],
    );
    return id;
  }

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('lists the caller notifications with the joined RFQ + artwork summary (no collector_sub leak)', async () => {
    const user = await registerUser('notif-list@example.com');
    const { rfqId, artworkId } = await seedRfq('Starry Void');
    const notifId = await seedNotification(rfqId, artworkId, user.sub);

    const res = await request(server).get(NOTIFS).set(auth(user.accessToken)).expect(200);
    const body = res.body as Paged;
    expect(body.meta.total).toBe(1);
    const item = body.data[0];
    expect(item.id).toBe(notifId);
    expect(item.rfqId).toBe(rfqId);
    expect(item.artworkId).toBe(artworkId);
    expect(item.artworkTitle).toBe('Starry Void');
    expect(item.artworkSlug).toMatch(/^starry-void-/);
    expect(item.maxPricePerFractionStroops).toBe('150000000');
    expect(item.fractionCount).toBe('100');
    expect(item.rfqStatus).toBe('open');
    expect(item.readAt).toBeNull();
    expect(item).not.toHaveProperty('collectorSub');
  });

  it('unread filter + unread-count reflect mark-read; PATCH is idempotent', async () => {
    const user = await registerUser('notif-read@example.com');
    const { rfqId, artworkId } = await seedRfq();
    const notifId = await seedNotification(rfqId, artworkId, user.sub);

    // unread count = 1
    let count = await request(server).get(`${NOTIFS}/unread-count`).set(auth(user.accessToken)).expect(200);
    expect((count.body as { count: number }).count).toBe(1);

    // mark read
    const patch = await request(server).patch(`${NOTIFS}/${notifId}/read`).set(auth(user.accessToken)).expect(200);
    const readAt = (patch.body as NotifItem).readAt;
    expect(readAt).not.toBeNull();

    // second PATCH is idempotent (unchanged readAt)
    const patch2 = await request(server).patch(`${NOTIFS}/${notifId}/read`).set(auth(user.accessToken)).expect(200);
    expect((patch2.body as NotifItem).readAt).toBe(readAt);

    // unread filter now empty, unread-count 0
    const unread = await request(server).get(`${NOTIFS}?filter=unread`).set(auth(user.accessToken)).expect(200);
    expect((unread.body as Paged).meta.total).toBe(0);
    count = await request(server).get(`${NOTIFS}/unread-count`).set(auth(user.accessToken)).expect(200);
    expect((count.body as { count: number }).count).toBe(0);
  });

  it('is owner-scoped: user B cannot see or mark user A notifications (404, no oracle)', async () => {
    const a = await registerUser('notif-a@example.com');
    const b = await registerUser('notif-b@example.com');
    const { rfqId, artworkId } = await seedRfq();
    const notifId = await seedNotification(rfqId, artworkId, a.sub);

    // B lists → empty
    const bList = await request(server).get(NOTIFS).set(auth(b.accessToken)).expect(200);
    expect((bList.body as Paged).meta.total).toBe(0);

    // B PATCHes A notification → 404 NOTIFICATION_NOT_FOUND
    const bPatch = await request(server).patch(`${NOTIFS}/${notifId}/read`).set(auth(b.accessToken)).expect(404);
    expect((bPatch.body as { errorCode: string }).errorCode).toBe('NOTIFICATION_NOT_FOUND');
  });

  it('rejects unauthenticated reads (401) and validates inputs (400 uuid, 404 unknown, 400 limit)', async () => {
    const user = await registerUser('notif-val@example.com');
    await request(server).get(NOTIFS).expect(401);
    await request(server).patch(`${NOTIFS}/not-a-uuid/read`).set(auth(user.accessToken)).expect(400);
    await request(server).patch(`${NOTIFS}/${randomUUID()}/read`).set(auth(user.accessToken)).expect(404);
    await request(server).get(`${NOTIFS}?limit=101`).set(auth(user.accessToken)).expect(400);
  });
});
