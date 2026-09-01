import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as bcrypt from 'bcrypt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { AppModule } from '../../src/app.module';
import { truncateTables, noOpThrottlerStorage } from '../shared/helpers';
import { insertOffering } from '../shared/seed-offering';
import { OFFERING_ESCROW_SERVICE } from '../../src/modules/offerings/escrow/offering-escrow.service.interface';
import { FakeOfferingEscrowService } from '../shared/fake-offering-escrow.service';
import { OfferingReconcileProcessor } from '../../src/modules/offerings/deploy/offering-reconcile.processor';

/**
 * TOV-154 offering multi-sig approval + escrow deploy (POST /offerings/:id/approve, GET /offerings[:id]).
 *
 * Requires the local `tove_test` DB (migrated: `yarn db:test:setup`) + Redis (idempotency + BullMQ). The
 * on-chain escrow deploy is faked via `OFFERING_ESCROW_SERVICE` override, so the real deploy worker drains
 * the queue against the fake. The `.env` roster `OFFERING_APPROVAL_SIGNERS` holds the two admin UUIDs seeded
 * below (threshold 2), so approvals reach quorum without a config override.
 */
interface ApproveBody {
  offeringId: string;
  status: string;
  approvals: { count: number; threshold: number; youApproved: boolean };
  escrow: { deployStatus: string | null; contractAddress: string | null };
  attestedArtistAddress: string | null;
  errorCode?: string;
}
interface DetailBody extends ApproveBody {
  id: string;
}

describe('Offering approval + escrow deploy (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: object;
  const fakeEscrow = new FakeOfferingEscrowService();

  // These two MUST equal the first two OFFERING_APPROVAL_SIGNERS in .env (roster is the gate).
  const ADMIN_A_ID = '84ab3cbc-a2f5-4ee4-884e-be954c3d0132';
  const ADMIN_B_ID = '2612b6f2-fdde-4d20-bf17-eca6f718b6e6';
  const NON_SIGNER_ID = '11111111-1111-4111-8111-111111111111';
  const password = 'SuperAdmin1!@#';

  const ARTIST_ID = '00000000-0000-4000-8000-000000154001';
  const ARTWORK_ID = '00000000-0000-4000-8000-000000154010';
  const FC_ID = '00000000-0000-4000-8000-000000154011';
  // Secondary artwork/fc so a second (non-terminal) offering can coexist (one-active-per-artwork).
  const ARTWORK2_ID = '00000000-0000-4000-8000-000000154030';
  const FC2_ID = '00000000-0000-4000-8000-000000154031';
  const OFFERING_ID = '00000000-0000-4000-8000-000000154020';
  const ARTIST_ADDRESS = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
  const TOKEN_ADDRESS = 'CDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
  // A valid C-address for directly-seeded escrow rows (the deploy path derives its own address).
  const SEED_ESCROW_ADDR = 'CDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
  const C_ADDR_RE = /^C[A-Z2-7]{55}$/;
  const WASM_HASH = 'a'.repeat(64);
  const PUBLIC_FLOAT = '850000000';

  async function seedAdmin(id: string, email: string, role: 'admin' | 'superadmin'): Promise<void> {
    const passwordHash = await bcrypt.hash(password, 12);
    await dataSource.query(
      `INSERT INTO "admins" ("id","email","password_hash","role","is_active","created_at","updated_at")
       VALUES ($1,$2,$3,$4,true,now(),now()) ON CONFLICT ("id") DO NOTHING`,
      [id, email, passwordHash, role],
    );
  }
  async function seedFixtures(): Promise<void> {
    await dataSource.query(
      `INSERT INTO "users" ("id","email","password_hash","is_active") VALUES ($1,NULL,NULL,true) ON CONFLICT ("id") DO NOTHING`,
      [ARTIST_ID],
    );
    await dataSource.query(
      `INSERT INTO "artworks" ("id","status","artist_user_id","title") VALUES ($1,'fractionalized',$2,'M05') ON CONFLICT ("id") DO NOTHING`,
      [ARTWORK_ID, ARTIST_ID],
    );
    await dataSource.query(
      `INSERT INTO "fraction_contracts"
         ("id","artwork_id","status","token_address","wasm_hash","token_name","token_symbol","artist_address",
          "total_supply","artist_retention_pct","treasury_retention_pct","artist_retention_amount",
          "treasury_retention_amount","artist_lockup_days","treasury_lockup_days")
       VALUES ($1,$2,'deployed',$3,$4,'M05','M5T',$5,'1000000000',10,5,'100000000','50000000',365,730)
       ON CONFLICT ("id") DO NOTHING`,
      [FC_ID, ARTWORK_ID, TOKEN_ADDRESS, WASM_HASH, ARTIST_ADDRESS],
    );
  }
  // Seed a second fractionalized artwork + deployed fraction_contract (for a coexisting offering).
  async function seedArtwork2(): Promise<void> {
    await dataSource.query(
      `INSERT INTO "artworks" ("id","status","artist_user_id","title") VALUES ($1,'fractionalized',$2,'M05-2') ON CONFLICT ("id") DO NOTHING`,
      [ARTWORK2_ID, ARTIST_ID],
    );
    await dataSource.query(
      `INSERT INTO "fraction_contracts"
         ("id","artwork_id","status","token_address","wasm_hash","token_name","token_symbol","artist_address",
          "total_supply","artist_retention_pct","treasury_retention_pct","artist_retention_amount",
          "treasury_retention_amount","artist_lockup_days","treasury_lockup_days")
       VALUES ($1,$2,'deployed',$3,$4,'M05-2','M52',$5,'1000000000',10,5,'100000000','50000000',365,730)
       ON CONFLICT ("id") DO NOTHING`,
      [FC2_ID, ARTWORK2_ID, TOKEN_ADDRESS, WASM_HASH, ARTIST_ADDRESS],
    );
  }
  // Seed an offering directly (bypassing the planning endpoint). Defaults to the primary artwork/fc.
  async function seedPlannedOffering(
    id: string,
    opts: { status?: string; windowOpenAt?: string; escrowAddress?: string; artworkId?: string; fcId?: string } = {},
  ): Promise<void> {
    await insertOffering((t: string, p?: unknown[]) => dataSource.query(t, p), {
      id,
      artworkId: opts.artworkId ?? ARTWORK_ID,
      fractionContractId: opts.fcId ?? FC_ID,
      status: opts.status ?? 'planned',
      publicFloat: PUBLIC_FLOAT,
      windowOpenAt: opts.windowOpenAt ?? '2027-01-01T00:00:00Z',
      windowCloseAt: '2027-01-08T00:00:00Z',
      createdByAdminSub: ADMIN_A_ID,
      escrowContractAddress: opts.escrowAddress ?? null,
      onConflictDoNothing: true,
    });
  }

  // Idempotency keys persist in Redis across runs (24h TTL) while the DB is truncated each run — a bare
  // literal key would REPLAY a prior run's response (no DB insert). Scope keys to this run; a repeated
  // logical key within a test still replays (same string), which is what the replay case needs.
  const runId = randomUUID().slice(0, 8);

  const login = async (id: string): Promise<string> => {
    const email = `off154-${id.slice(0, 8)}@example.com`;
    const res = await request(server).post('/api/backoffice/v1/auth/login').send({ email, password });
    return (res.body as { accessToken: string }).accessToken;
  };
  const approve = (token: string, offeringId: string, key: string) =>
    request(server)
      .post(`/api/backoffice/v1/offerings/${offeringId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `${runId}-${key}`)
      .send({});
  const getOne = (token: string, offeringId: string) =>
    request(server).get(`/api/backoffice/v1/offerings/${offeringId}`).set('Authorization', `Bearer ${token}`);

  async function pollDeployStatus(token: string, offeringId: string, want: string): Promise<DetailBody> {
    for (let i = 0; i < 40; i++) {
      const res = await getOne(token, offeringId);
      const body = res.body as DetailBody;
      if (body.status === want || body.escrow?.deployStatus === want) return body;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`timed out waiting for ${want} on ${offeringId}`);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noOpThrottlerStorage)
      .overrideProvider(OFFERING_ESCROW_SERVICE)
      .useValue(fakeEscrow)
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
    fakeEscrow.reset();
    await seedAdmin(ADMIN_A_ID, `off154-${ADMIN_A_ID.slice(0, 8)}@example.com`, 'admin');
    await seedAdmin(ADMIN_B_ID, `off154-${ADMIN_B_ID.slice(0, 8)}@example.com`, 'admin');
    await seedFixtures();
    await seedPlannedOffering(OFFERING_ID);
  });

  // ── AC-1 ────────────────────────────────────────────────────────────────
  it('AC-1: 2-of-3 approval deploys the escrow and moves the offering to approved (positive)', async () => {
    const tokenA = await login(ADMIN_A_ID);
    const tokenB = await login(ADMIN_B_ID);

    const r1 = await approve(tokenA, OFFERING_ID, 'e1-a').expect(202);
    const b1 = r1.body as ApproveBody;
    expect(b1.approvals).toMatchObject({ count: 1, threshold: 2, youApproved: true });
    expect(b1.status).toBe('planned');
    expect(b1.escrow.deployStatus).toBeNull();
    expect(b1.attestedArtistAddress).toBe(ARTIST_ADDRESS); // frozen at first approval

    const r2 = await approve(tokenB, OFFERING_ID, 'e1-b').expect(202);
    const b2 = r2.body as ApproveBody;
    expect(b2.approvals.count).toBe(2);
    expect(b2.escrow.deployStatus).toBe('deploying'); // quorum → deploy claimed

    const done = await pollDeployStatus(tokenA, OFFERING_ID, 'approved');
    expect(done.status).toBe('approved');
    expect(done.escrow.contractAddress).toMatch(C_ADDR_RE);
    expect(fakeEscrow.deployCalls.length).toBe(1);

    const rows: Array<Record<string, string>> = await dataSource.query(
      `SELECT status, escrow_deploy_status, escrow_contract_address FROM offerings WHERE id=$1`,
      [OFFERING_ID],
    );
    expect(rows[0]).toMatchObject({ status: 'approved', escrow_deploy_status: 'deployed' });
    expect(rows[0].escrow_contract_address).toMatch(C_ADDR_RE);
    expect(rows[0].escrow_contract_address).toBe(done.escrow.contractAddress);
  });

  it('AC-1 first approval returns count 1 / threshold 2 and does not deploy (edge)', async () => {
    const tokenA = await login(ADMIN_A_ID);
    const r = await approve(tokenA, OFFERING_ID, 'e3-a').expect(202);
    expect((r.body as ApproveBody).approvals).toMatchObject({ count: 1, threshold: 2, youApproved: true });
    expect(fakeEscrow.deployCalls.length).toBe(0);
  });

  // ── AC-2 ────────────────────────────────────────────────────────────────
  it('AC-2: a single approval past the TTL expires and the offering stays planned (negative)', async () => {
    // Seed one live approval aged past the 7-day TTL (direct insert; the endpoint would set created_at=now()).
    await dataSource.query(
      `INSERT INTO "offering_approvals" ("id","offering_id","admin_sub","created_at","updated_at")
       VALUES (gen_random_uuid(), $1, $2, now() - interval '8 days', now())`,
      [OFFERING_ID, ADMIN_A_ID],
    );
    await app.get(OfferingReconcileProcessor).process({ data: {} });

    const rows: Array<Record<string, string | null>> = await dataSource.query(
      `SELECT o.status, (SELECT count(*) FROM offering_approvals a WHERE a.offering_id=o.id AND a.deleted_at IS NULL) AS live
         FROM offerings o WHERE o.id=$1`,
      [OFFERING_ID],
    );
    expect(rows[0].status).toBe('planned');
    expect(Number(rows[0].live)).toBe(0);
    const audit: Array<Record<string, string>> = await dataSource.query(
      `SELECT kind FROM internal_audit_log WHERE subject_id=$1 AND kind='offering.approval.expired'`,
      [OFFERING_ID],
    );
    expect(audit.length).toBe(1);
  });

  // ── auth ──────────────────────────────────────────────────────────────────
  it('403 OFFERING_APPROVAL_NOT_A_SIGNER for a valid admin not in the roster; 401 without a token (negative)', async () => {
    await seedAdmin(NON_SIGNER_ID, `off154-${NON_SIGNER_ID.slice(0, 8)}@example.com`, 'superadmin');
    const tokenNon = await login(NON_SIGNER_ID);
    const res = await approve(tokenNon, OFFERING_ID, 'e4-x').expect(403);
    expect((res.body as ApproveBody).errorCode).toBe('OFFERING_APPROVAL_NOT_A_SIGNER');

    await request(server)
      .post(`/api/backoffice/v1/offerings/${OFFERING_ID}/approve`)
      .set('Idempotency-Key', 'e4-noauth')
      .send({})
      .expect(401);
  });

  // ── idempotency + state ────────────────────────────────────────────────────
  it('idempotent replay returns the original body; 404 unknown; 409 not-planned (negative/edge)', async () => {
    const tokenA = await login(ADMIN_A_ID);
    const first = await approve(tokenA, OFFERING_ID, 'e5-rep').expect(202);
    const replay = await approve(tokenA, OFFERING_ID, 'e5-rep').expect(202);
    expect((replay.body as ApproveBody).approvals.count).toBe((first.body as ApproveBody).approvals.count);

    // Unknown offering.
    const unknown = await approve(tokenA, '00000000-0000-4000-8000-0000000000ff', 'e5-unknown').expect(404);
    expect((unknown.body as ApproveBody).errorCode).toBe('OFFERING_NOT_FOUND');

    // Not-planned: seed an already-approved offering (under a second artwork to avoid one-active clash).
    const approvedId = '00000000-0000-4000-8000-000000154099';
    await seedArtwork2();
    await seedPlannedOffering(approvedId, {
      status: 'approved',
      escrowAddress: SEED_ESCROW_ADDR,
      artworkId: ARTWORK2_ID,
      fcId: FC2_ID,
    });
    const conflict = await approve(tokenA, approvedId, 'e5-conflict').expect(409);
    expect((conflict.body as ApproveBody).errorCode).toBe('OFFERING_NOT_PLANNED');
  });

  // ── failed deploy → retry reaches approved (proves per-attempt jobId fix) ──
  it('a failed deploy leaves the offering planned and a fresh approval retries to approved (edge)', async () => {
    fakeEscrow.failOn = new Set([OFFERING_ID]);
    const tokenA = await login(ADMIN_A_ID);
    const tokenB = await login(ADMIN_B_ID);
    await approve(tokenA, OFFERING_ID, 'e7-a').expect(202);
    await approve(tokenB, OFFERING_ID, 'e7-b').expect(202);

    const failed = await pollDeployStatus(tokenA, OFFERING_ID, 'failed');
    expect(failed.escrow.deployStatus).toBe('failed');
    expect(failed.status).toBe('planned');

    // Clear the fault and re-approve with a fresh key — the DB CAS re-claims and a new job runs.
    fakeEscrow.failOn = undefined;
    await approve(tokenA, OFFERING_ID, 'e7-retry').expect(202);
    const done = await pollDeployStatus(tokenA, OFFERING_ID, 'approved');
    expect(done.status).toBe('approved');
    expect(done.escrow.contractAddress).toMatch(C_ADDR_RE);
  });

  // ── P1 (todo 283): stale-deploying recovery ─────────────────────────────────
  it('reconcile re-drives an offering wedged in deploying (lost enqueue) to approved (edge)', async () => {
    // Simulate a crash between the approve commit and the (best-effort) enqueue: the row is 'deploying'
    // with no live job and an updated_at past the grace window. The stale-deploying sweep must re-drive it.
    await dataSource.query(
      `UPDATE offerings
         SET escrow_deploy_status='deploying', snapshot_artist_address=$2,
             updated_at = now() - interval '5 minutes'
       WHERE id=$1`,
      [OFFERING_ID, ARTIST_ADDRESS],
    );
    await app.get(OfferingReconcileProcessor).process({ data: {} });

    const tokenA = await login(ADMIN_A_ID);
    const done = await pollDeployStatus(tokenA, OFFERING_ID, 'approved');
    expect(done.status).toBe('approved');
    expect(done.escrow.contractAddress).toMatch(C_ADDR_RE);
    expect(fakeEscrow.deployCalls.length).toBe(1);
  });

  // ── window-open via reconcile sweep ─────────────────────────────────────────
  it('reconcile opens an approved offering whose window_open_at has passed (edge)', async () => {
    const openId = '00000000-0000-4000-8000-000000154088';
    await seedArtwork2();
    await seedPlannedOffering(openId, {
      status: 'approved',
      escrowAddress: SEED_ESCROW_ADDR,
      windowOpenAt: '2020-01-01T00:00:00Z',
      artworkId: ARTWORK2_ID,
      fcId: FC2_ID,
    });
    await app.get(OfferingReconcileProcessor).process({ data: {} });
    const tokenA = await login(ADMIN_A_ID);
    const res = await getOne(tokenA, openId).expect(200);
    expect((res.body as DetailBody).status).toBe('opened');
  });

  // ── list ────────────────────────────────────────────────────────────────────
  it('GET /offerings lists the approval queue with per-caller youApproved (positive)', async () => {
    const tokenA = await login(ADMIN_A_ID);
    await approve(tokenA, OFFERING_ID, 'e9-a').expect(202);

    const res = await request(server)
      .get('/api/backoffice/v1/offerings?status=planned')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const body = res.body as { data: Array<{ id: string; status: string; approvals: { count: number; youApproved: boolean } }>; meta: { total: number } };
    const row = body.data.find((o) => o.id === OFFERING_ID);
    expect(row).toBeDefined();
    expect(row?.status).toBe('planned');
    expect(row?.approvals).toMatchObject({ count: 1, youApproved: true });

    // A non-signer-but-admin caller sees the queue but youApproved=false.
    await seedAdmin(NON_SIGNER_ID, `off154-${NON_SIGNER_ID.slice(0, 8)}@example.com`, 'admin');
    const tokenNon = await login(NON_SIGNER_ID);
    const res2 = await request(server)
      .get('/api/backoffice/v1/offerings?status=planned')
      .set('Authorization', `Bearer ${tokenNon}`)
      .expect(200);
    const body2 = res2.body as { data: Array<{ id: string; approvals: { youApproved: boolean } }> };
    expect(body2.data.find((o) => o.id === OFFERING_ID)?.approvals.youApproved).toBe(false);

    // No token → 401.
    await request(server).get('/api/backoffice/v1/offerings').expect(401);
  });
});
