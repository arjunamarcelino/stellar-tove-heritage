import { randomUUID } from 'node:crypto';
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
import { FRACTION_READ_SERVICE } from '../../src/modules/fractionalization/fraction-read.service.interface';
import { KYC_ALLOWLIST_TX_SERVICE } from '../../src/modules/kyc-allowlist/kyc-allowlist-tx.service.interface';
import { noOpThrottlerStorage } from '../shared/helpers';
import { FakeRelayerService } from '../shared/fake-relayer';
import { FakeFractionReadService } from '../shared/fake-fraction-read';
import { FakeKycAllowlistService } from '../shared/fake-kyc-allowlist';
import { insertArtwork, insertArtworkArtist } from '../shared/seed-artwork';
import { createSoftwarePasskey, buildAttestation, signAssertion, type SoftwarePasskey } from '../shared/webauthn-authenticator';

const BEGIN = '/api/v1/auth/passkey/register/begin';
const FINISH = '/api/v1/auth/passkey/register/finish';
const RP_ID = 'tove.io';
const ORIGIN = 'https://tove.io';
const FRACTION = 'CDL5YRUNMPGJ42KQFDEKTJBTVBAQGKAGQRJ44DRFBJSMZMBBTACGAQYI';
const OTHER_ARTIST = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';

interface FinishResponse {
  accessToken: string;
  contractAddress: string;
}
interface RegisteredUser extends FinishResponse {
  passkey: SoftwarePasskey;
  walletId: string;
  userId: string;
}
interface RotateItem {
  itemId: string;
  tokenContract: string;
  amountScaled: string;
  challenge: string;
}
interface RotateResponse {
  rotationId: string;
  items: RotateItem[];
}

describe('Wallet rotation (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: object;
  const relayer = new FakeRelayerService();
  const fractionRead = new FakeFractionReadService();
  const allowlist = new FakeKycAllowlistService();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noOpThrottlerStorage)
      .overrideProvider(RELAYER_SERVICE)
      .useValue(relayer)
      .overrideProvider(FRACTION_READ_SERVICE)
      .useValue(fractionRead)
      .overrideProvider(KYC_ALLOWLIST_TX_SERVICE)
      .useValue(allowlist)
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
    fractionRead.reset();
    allowlist.reset();
  });

  async function rawQuery<T>(text: string, params: unknown[] = []): Promise<T[]> {
    return (await dataSource.query(text, params));
  }
  const q = (text: string, params: unknown[] = []) => dataSource.query(text, params);

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

  /** Bind a BYOW settlement wallet and make it the primary (demoting the genesis embedded wallet). */
  async function addByowPrimary(u: RegisteredUser): Promise<{ id: string; pubkey: string }> {
    const pubkey = Keypair.random().publicKey();
    await q(`UPDATE wallets SET is_primary = false WHERE user_id = $1`, [u.userId]);
    const [row] = (await q(
      `INSERT INTO wallets (user_id, public_key, kind, status, is_primary) VALUES ($1, $2, 'byow', 'active', true) RETURNING id`,
      [u.userId, pubkey],
    )) as { id: string }[];
    return { id: row.id, pubkey };
  }

  /** Seed a deployed fraction contract (source is the artist only when `artistAddress` == the source contract). */
  async function seedDeployedFraction(opts: {
    artistAddress: string;
    artistLockupUntil?: string | null;
    artistRetentionAmount?: string | null;
  }): Promise<void> {
    const artist = await insertArtworkArtist(q, randomUUID());
    const artworkId = await insertArtwork(q, { artistUserId: artist, status: 'fractionalized' });
    await q(
      `INSERT INTO fraction_contracts
         (artwork_id, status, token_address, wasm_hash, token_name, token_symbol, artist_address,
          total_supply, artist_retention_pct, treasury_retention_pct, artist_retention_amount,
          artist_lockup_days, treasury_lockup_days, artist_lockup_until)
       VALUES ($1,'deployed',$2,$3,'Art','ART',$4,'1000',10,0,$5,30,0,$6)`,
      [
        artworkId,
        FRACTION,
        'a'.repeat(64),
        opts.artistAddress,
        opts.artistRetentionAmount ?? null,
        opts.artistLockupUntil ?? null,
      ],
    );
  }

  const initiate = (u: RegisteredUser, destId: string) =>
    request(server)
      .post(`/api/v1/me/wallets/${u.walletId}/rotate-transfer`)
      .set('Authorization', `Bearer ${u.accessToken}`)
      .send({ destinationWalletId: destId });

  it('rotates all fraction holdings source→destination, records custody_transfer, keeps identity', async () => {
    const u = await registerUser('rotate-happy@example.com');
    const dest = await addByowPrimary(u);
    allowlist.setAllowed(dest.pubkey);
    await seedDeployedFraction({ artistAddress: OTHER_ARTIST }); // collector holds it → never locked
    fractionRead.balances.set(FRACTION, '5'); // source holds 5 fractions at initiate

    const built = (await initiate(u, dest.id).expect(200)).body as RotateResponse;
    expect(built.items).toHaveLength(1);
    expect(built.items[0]).toMatchObject({ tokenContract: FRACTION, amountScaled: '5' });

    // The transfer lands on-chain → the source is now drained (drives the completion re-read).
    fractionRead.balances.set(FRACTION, '0');
    const items = built.items.map((it) => ({
      itemId: it.itemId,
      ...signAssertion({ passkey: u.passkey, challenge: it.challenge, rpId: RP_ID, origin: ORIGIN }),
    }));
    const submit = await request(server)
      .post(`/api/v1/me/wallets/${u.walletId}/rotate-transfer/submit`)
      .set('Authorization', `Bearer ${u.accessToken}`)
      .send({ rotationId: built.rotationId, items })
      .expect(200);
    expect((submit.body as { status: string }).status).toBe('completed');

    // A custody_transfer registry row per confirmed transfer (from = source contract, to = W2).
    const reg = await rawQuery<{ event_type: string; from_address: string; to_address: string; amount_scaled: string }>(
      'SELECT event_type, from_address, to_address, amount_scaled FROM registry_events',
    );
    expect(reg).toHaveLength(1);
    expect(reg[0]).toMatchObject({
      event_type: 'custody_transfer',
      from_address: u.contractAddress,
      to_address: dest.pubkey,
      amount_scaled: '5',
    });

    // Identity survives: the source wallet is NOT latched exported (rotation only moves holdings).
    const w = await rawQuery<{ status: string }>('SELECT status FROM wallets WHERE id = $1', [u.walletId]);
    expect(w[0].status).toBe('active');

    // Status read reflects the completed rotation.
    const status = await request(server)
      .get(`/api/v1/me/wallets/${u.walletId}/rotate-transfer/status`)
      .set('Authorization', `Bearer ${u.accessToken}`)
      .expect(200);
    const st = status.body as { state: string; destinationWalletId: string; destinationAddress: string };
    expect(st.state).toBe('confirmed');
    expect(st.destinationWalletId).toBe(dest.id); // server-authoritative for the FE resume/lock (Q7)
    expect(st.destinationAddress).toBe(dest.pubkey);
  });

  it('blocks rotation of a locked artist-retention position with 422 ROTATION_BLOCKED_BY_LOCKUP', async () => {
    const u = await registerUser('rotate-lockup@example.com');
    const dest = await addByowPrimary(u);
    allowlist.setAllowed(dest.pubkey);
    const future = String(Math.floor(Date.now() / 1000) + 100000);
    // The source wallet IS the artist, retention is locked → the whole rotation is refused.
    await seedDeployedFraction({ artistAddress: u.contractAddress, artistLockupUntil: future, artistRetentionAmount: '100' });
    fractionRead.balances.set(FRACTION, '100');

    const res = await initiate(u, dest.id).expect(422);
    const body = res.body as { errorCode: string; lockupExpiresAt: string };
    expect(body.errorCode).toBe('ROTATION_BLOCKED_BY_LOCKUP');
    // Machine-readable expiry for the FE review-step copy (TOV-48 AC): ISO-8601 matching the seeded future lockup.
    expect(new Date(body.lockupExpiresAt).getTime()).toBe(Number(future) * 1000);
  });

  it('rejects a destination that is not the primary with 409 ROTATION_DESTINATION_NOT_PRIMARY', async () => {
    const u = await registerUser('rotate-notprimary@example.com');
    const pubkey = Keypair.random().publicKey();
    const [dest] = await rawQuery<{ id: string }>(
      `INSERT INTO wallets (user_id, public_key, kind, status, is_primary) VALUES ($1,$2,'byow','active',false) RETURNING id`,
      [u.userId, pubkey],
    );
    const res = await initiate(u, dest.id).expect(409);
    expect((res.body as { errorCode: string }).errorCode).toBe('ROTATION_DESTINATION_NOT_PRIMARY');
  });

  it('rejects a destination not on the KYC allowlist with 422 RECIPIENT_NOT_WHITELISTED', async () => {
    const u = await registerUser('rotate-nowl@example.com');
    const dest = await addByowPrimary(u); // NOT allowlisted
    await seedDeployedFraction({ artistAddress: OTHER_ARTIST });
    fractionRead.balances.set(FRACTION, '5');
    const res = await initiate(u, dest.id).expect(422);
    expect((res.body as { errorCode: string }).errorCode).toBe('RECIPIENT_NOT_WHITELISTED');
  });

  it('cancels an initiated rotation (no in-flight item) and frees the source for a fresh rotation', async () => {
    const u = await registerUser('rotate-cancel@example.com');
    const dest = await addByowPrimary(u);
    allowlist.setAllowed(dest.pubkey);
    await seedDeployedFraction({ artistAddress: OTHER_ARTIST });
    fractionRead.balances.set(FRACTION, '5');

    const built = (await initiate(u, dest.id).expect(200)).body as RotateResponse;
    const cancel = await request(server)
      .delete(`/api/v1/me/wallets/${u.walletId}/rotate-transfer`)
      .set('Authorization', `Bearer ${u.accessToken}`)
      .expect(200);
    expect((cancel.body as { canceledId: string }).canceledId).toBe(built.rotationId);

    // The one-active latch is cleared → a fresh initiate creates a NEW rotation.
    const again = (await initiate(u, dest.id).expect(200)).body as RotateResponse;
    expect(again.rotationId).not.toBe(built.rotationId);
  });

  it('a non-terminal export on the source blocks rotation (409); a terminal failed export does not (todo 431)', async () => {
    const u = await registerUser('rotate-exportconflict@example.com');
    const dest = await addByowPrimary(u);
    allowlist.setAllowed(dest.pubkey);
    await seedDeployedFraction({ artistAddress: OTHER_ARTIST });
    fractionRead.balances.set(FRACTION, '5');

    const seedExport = (status: string) =>
      q(
        `INSERT INTO wallet_exports (wallet_id, user_id, target_address, status) VALUES ($1,$2,$3,$4) RETURNING id`,
        [u.walletId, u.userId, Keypair.random().publicKey(), status],
      );

    // Active (submitting) export → 409 ROTATION_CONFLICT.
    const [exp] = (await seedExport('submitting')) as { id: string }[];
    const blocked = await initiate(u, dest.id).expect(409);
    expect((blocked.body as { errorCode: string }).errorCode).toBe('ROTATION_CONFLICT');

    // Terminal `failed` export must NOT block a fresh rotation (active-only scoping).
    await q(`UPDATE wallet_exports SET status='failed' WHERE id=$1`, [exp.id]);
    await initiate(u, dest.id).expect(200);
  });

  it('an active rotation blocks a new export on the same wallet with 409 ROTATION_CONFLICT (todo 431)', async () => {
    const u = await registerUser('export-rotationconflict@example.com');
    const dest = await addByowPrimary(u);
    // Seed an active rotation directly on the embedded source wallet.
    await q(
      `INSERT INTO wallet_rotation_transfers (user_id, source_wallet_id, destination_wallet_id, destination_address, status)
       VALUES ($1,$2,$3,$4,'submitting')`,
      [u.userId, u.walletId, dest.id, dest.pubkey],
    );
    await q(`INSERT INTO fraction_kyc_allowlist (target_address) VALUES ($1)`, [dest.pubkey]);
    relayer.setHolding(u.contractAddress, 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA', '1000000');
    const res = await request(server)
      .post(`/api/v1/me/wallets/${u.walletId}/export`)
      .set('Authorization', `Bearer ${u.accessToken}`)
      .send({ targetAddress: dest.pubkey })
      .expect(409);
    expect((res.body as { errorCode: string }).errorCode).toBe('ROTATION_CONFLICT');
  });

  it('rejects an unauthenticated rotation with 401', async () => {
    await request(server)
      .post('/api/v1/me/wallets/00000000-0000-0000-0000-000000000000/rotate-transfer')
      .send({ destinationWalletId: '00000000-0000-0000-0000-000000000000' })
      .expect(401);
  });
});
