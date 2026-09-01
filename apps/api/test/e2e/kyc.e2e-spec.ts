import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { KYC_STORAGE } from '../../src/modules/kyc/kyc.util';
import { truncateTables, noOpThrottlerStorage } from '../shared/helpers';
import { InMemoryStorage } from '../shared/in-memory-storage';

interface TokenResponse {
  accessToken: string;
}
interface SubmitResBody {
  submissionId: string;
  status: string;
  kycStatus: string;
}
interface ErrorBody {
  errorCode: string;
}
interface StatusBody {
  kycStatus: string;
  latestSubmission: { claimedJurisdiction: string } | null;
}
interface CountRow {
  n: number;
}
interface PayloadRow {
  payload: unknown;
}

// Minimal valid files whose magic bytes match their declared Content-Type.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7', 'ascii'), Buffer.alloc(64, 3)]);

describe('KYC (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: object;
  let storage: InMemoryStorage;

  beforeAll(async () => {
    storage = new InMemoryStorage();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noOpThrottlerStorage)
      .overrideProvider(KYC_STORAGE)
      .useValue(storage)
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
    await truncateTables(dataSource);
    storage.objects.clear();
  });

  let userSeq = 0;
  async function registerToken(): Promise<string> {
    userSeq += 1;
    const res = await request(server).post('/api/v1/auth/register').send({
      email: `kyc${userSeq}@example.com`,
      password: 'StrongPass1!@#',
      firstName: 'K',
      lastName: 'Y',
    });
    return (res.body as TokenResponse).accessToken;
  }

  function submit(
    token: string,
    opts: { jurisdiction?: string; idempotencyKey?: string; omit?: string } = {},
  ) {
    const req = request(server)
      .post('/api/v1/me/kyc/submissions')
      .set('Authorization', `Bearer ${token}`);
    if (opts.idempotencyKey !== undefined) req.set('Idempotency-Key', opts.idempotencyKey);
    req.field('claimedJurisdiction', opts.jurisdiction ?? 'GB');
    if (opts.omit !== 'gov_id_front') req.attach('gov_id_front', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' });
    if (opts.omit !== 'gov_id_back') req.attach('gov_id_back', PNG, { filename: 'b.png', contentType: 'image/png' });
    if (opts.omit !== 'proof_of_address') req.attach('proof_of_address', PDF, { filename: 'c.pdf', contentType: 'application/pdf' });
    if (opts.omit !== 'selfie') req.attach('selfie', JPEG, { filename: 'd.jpg', contentType: 'image/jpeg' });
    return req;
  }

  it('accepts a valid submission → 202, flips status, stores 4 encrypted blobs', async () => {
    const token = await registerToken();
    const res = await submit(token, { idempotencyKey: 'k1' });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'pending_review', kycStatus: 'pending_review' });
    expect((res.body as SubmitResBody).submissionId).toBeDefined();

    expect(storage.objects.size).toBe(4);
    const docs = await dataSource.query<CountRow[]>(`SELECT count(*)::int AS n FROM kyc_documents`);
    expect(docs[0].n).toBe(4);
    const subs = await dataSource.query<CountRow[]>(`SELECT count(*)::int AS n FROM kyc_submissions WHERE status='pending_review'`);
    expect(subs[0].n).toBe(1);
    const audit = await dataSource.query<PayloadRow[]>(`SELECT payload FROM internal_audit_log WHERE kind='kyc.submission.created'`);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0].payload)).not.toContain('blobHash');
  });

  it('rejects a non-allowlisted jurisdiction → 422 JURISDICTION_NOT_ELIGIBLE, nothing stored', async () => {
    const token = await registerToken();
    const res = await submit(token, { jurisdiction: 'KP', idempotencyKey: 'k1' });
    expect(res.status).toBe(422);
    expect((res.body as ErrorBody).errorCode).toBe('JURISDICTION_NOT_ELIGIBLE');
    expect(storage.objects.size).toBe(0);
  });

  it('rejects a resubmission while pending → 409 KYC_ALREADY_PENDING', async () => {
    const token = await registerToken();
    await submit(token, { idempotencyKey: 'k1' }).expect(202);
    const res = await submit(token, { idempotencyKey: 'k2' });
    expect(res.status).toBe(409);
    expect((res.body as ErrorBody).errorCode).toBe('KYC_ALREADY_PENDING');
  });

  it('replays the original 202 for the same Idempotency-Key + body', async () => {
    const token = await registerToken();
    const first = await submit(token, { idempotencyKey: 'k1' }).expect(202);
    const replay = await submit(token, { idempotencyKey: 'k1' }).expect(202);
    expect((replay.body as SubmitResBody).submissionId).toBe((first.body as SubmitResBody).submissionId);
    const subs = await dataSource.query<CountRow[]>(`SELECT count(*)::int AS n FROM kyc_submissions`);
    expect(subs[0].n).toBe(1);
  });

  it('a resubmission after rejection links supersedes_submission_id to the prior submission', async () => {
    const token = await registerToken();
    const first = await submit(token, { idempotencyKey: 'k1' }).expect(202);
    const firstId = (first.body as SubmitResBody).submissionId;
    // Simulate an admin rejection (M12) via direct DB state so the collector may resubmit. The submission
    // row keeps the `rejected` review outcome; the USER folds back to `not_submitted` (TOV-29: user-level
    // `rejected` is no longer a whitelist state) so the resubmit's terminal-state guard permits the flip.
    await dataSource.query(`UPDATE kyc_submissions SET status='rejected' WHERE id=$1`, [firstId]);
    await dataSource.query(
      `UPDATE users SET kyc_status='not_submitted' WHERE id=(SELECT user_id FROM kyc_submissions WHERE id=$1)`,
      [firstId],
    );

    const second = await submit(token, { idempotencyKey: 'k2' }).expect(202);
    const secondId = (second.body as SubmitResBody).submissionId;
    const rows = await dataSource.query<{ supersedes_submission_id: string | null }[]>(
      `SELECT supersedes_submission_id FROM kyc_submissions WHERE id=$1`,
      [secondId],
    );
    expect(rows[0].supersedes_submission_id).toBe(firstId);
  });

  it('requires an Idempotency-Key → 400', async () => {
    const token = await registerToken();
    const res = await submit(token, {});
    expect(res.status).toBe(400);
  });

  it('rejects a missing document field → 422 KYC_MISSING_DOCUMENT', async () => {
    const token = await registerToken();
    const res = await submit(token, { idempotencyKey: 'k1', omit: 'selfie' });
    expect(res.status).toBe(422);
    expect((res.body as ErrorBody).errorCode).toBe('KYC_MISSING_DOCUMENT');
  });

  it('rejects an unauthenticated submission → 401', async () => {
    const res = await request(server)
      .post('/api/v1/me/kyc/submissions')
      .set('Idempotency-Key', 'k1')
      .field('claimedJurisdiction', 'GB')
      .attach('gov_id_front', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(401);
  });

  it('GET /me/kyc returns status + latest submission, no document data', async () => {
    const token = await registerToken();
    const before = await request(server).get('/api/v1/me/kyc').set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ kycStatus: 'not_submitted', latestSubmission: null });

    await submit(token, { idempotencyKey: 'k1' }).expect(202);
    const after = await request(server).get('/api/v1/me/kyc').set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(200);
    expect((after.body as StatusBody).kycStatus).toBe('pending_review');
    expect((after.body as StatusBody).latestSubmission?.claimedJurisdiction).toBe('GB');
    expect(JSON.stringify(after.body)).not.toContain('storage');
  });

  describe('GET /me/kyc/status (whitelist status card, TOV-29)', () => {
    // Derive the caller's id from the signed JWT `sub` (what @CurrentUser('sub') resolves to), NOT a
    // created_at-ordered query — robust even if a test registers more than one user.
    async function registerWithId(): Promise<{ token: string; userId: string }> {
      const token = await registerToken();
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString(),
      ) as { sub: string };
      return { token, userId: payload.sub };
    }
    const getStatus = (token?: string) => {
      const req = request(server).get('/api/v1/me/kyc/status');
      return token ? req.set('Authorization', `Bearer ${token}`) : req;
    };

    it('not_submitted: all four keys present with null metadata; no leaked vocabulary/fields', async () => {
      const token = await registerToken();
      const res = await getStatus(token);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 'not_submitted',
        whitelistedAt: null,
        reason: null,
        lastSubmissionAt: null,
      });
      // exactly these 4 keys — null present, not absent (E13)
      expect(Object.keys(res.body as object).sort()).toEqual([
        'lastSubmissionAt',
        'reason',
        'status',
        'whitelistedAt',
      ]);
      // no retired vocabulary or old-endpoint field names leak (E14)
      const body = JSON.stringify(res.body);
      for (const leak of ['approved', 'rejected', 'kycStatus', 'latestSubmission', 'storage']) {
        expect(body).not.toContain(leak);
      }
    });

    it('pending_review after a submit → status pending_review + lastSubmissionAt set', async () => {
      const token = await registerToken();
      await submit(token, { idempotencyKey: 'k1' }).expect(202);
      const res = await getStatus(token);
      expect(res.status).toBe(200);
      expect((res.body as { status: string }).status).toBe('pending_review');
      expect((res.body as { lastSubmissionAt: string | null }).lastSubmissionAt).not.toBeNull();
      expect((res.body as { whitelistedAt: string | null }).whitelistedAt).toBeNull();
    });

    it('whitelisted → surfaces whitelistedAt (ISO-8601 UTC); reason null', async () => {
      const { token, userId } = await registerWithId();
      await dataSource.query(
        `UPDATE users SET kyc_status='whitelisted', whitelisted_at='2026-07-17T10:00:00.000Z' WHERE id=$1`,
        [userId],
      );
      const res = await getStatus(token);
      expect(res.body).toMatchObject({
        status: 'whitelisted',
        whitelistedAt: '2026-07-17T10:00:00.000Z',
        reason: null,
      });
    });

    // frozen/removed share one gate row; the `removed` case below is the representative reason-gate +
    // leak-guard at the HTTP layer (frozen is covered exhaustively at the unit + integration layers).
    it('removed → surfaces the reason code, never a stale whitelisted_at (reason-gate + leak guard)', async () => {
      const { token, userId } = await registerWithId();
      await dataSource.query(
        `UPDATE users SET kyc_status='removed', kyc_reason='removed_by_request',
           whitelisted_at='2026-07-01T00:00:00.000Z' WHERE id=$1`,
        [userId],
      );
      const res = await getStatus(token);
      expect(res.body).toMatchObject({
        status: 'removed',
        reason: 'removed_by_request',
        whitelistedAt: null,
      });
    });

    it('rejects an unauthenticated read → 401', async () => {
      const res = await getStatus();
      expect(res.status).toBe(401);
    });

    it('valid token but soft-deleted user → 404 USER_NOT_FOUND', async () => {
      const { token, userId } = await registerWithId();
      await dataSource.query(`UPDATE users SET deleted_at = now() WHERE id=$1`, [userId]);
      const res = await getStatus(token);
      expect(res.status).toBe(404);
      expect((res.body as ErrorBody).errorCode).toBe('USER_NOT_FOUND');
    });

    it('is_active=false with a valid token still returns status (TOV-29 R2: low-sensitivity self-read)', async () => {
      const { token, userId } = await registerWithId();
      await dataSource.query(`UPDATE users SET is_active=false WHERE id=$1`, [userId]);
      const res = await getStatus(token);
      expect(res.status).toBe(200);
      expect((res.body as { status: string }).status).toBe('not_submitted');
    });
  });
});
