import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { noOpThrottlerStorage } from '../shared/helpers';
import { truncateTables } from '../integration/setup';
import { FakeStorageService } from '../shared/fake-storage';
import { insertArtwork, insertArtworkArtist } from '../shared/seed-artwork';
import { insertTimelineEvent } from '../shared/seed-timeline';

const ARTIST = '00000000-0000-4000-8000-0000000e2890';
const VERIFIED = '00000000-0000-4000-8000-0000000e2001';
const EMPTY = '00000000-0000-4000-8000-0000000e2002';
const PUBLISHED = '00000000-0000-4000-8000-0000000e2003';
const DELETED = '00000000-0000-4000-8000-0000000e2004';

type Body = Record<string, unknown>;
interface Event {
  id: string;
  eventType: string;
  visibilityTier: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
}

describe('Artwork timeline (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noOpThrottlerStorage)
      .overrideProvider('IStorageService')
      .useValue(new FakeStorageService())
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app?.close();
  });

  const get = (path: string) => request(app.getHttpServer() as object).get(path);
  const stableBody = (body: Body): Body => {
    const { timestamp: _t, ...rest } = body;
    void _t;
    return rest;
  };

  beforeEach(async () => {
    await truncateTables(dataSource);
    const q = (text: string, params?: unknown[]) => dataSource.query(text, params);
    await insertArtworkArtist(q, ARTIST);
    await insertArtwork(q, { id: VERIFIED, artistUserId: ARTIST, status: 'verified' });
    await insertArtwork(q, { id: EMPTY, artistUserId: ARTIST, status: 'fractionalized' });
    await insertArtwork(q, { id: PUBLISHED, artistUserId: ARTIST, status: 'published' });
    await insertArtwork(q, { id: DELETED, artistUserId: ARTIST, status: 'verified' });
    await q(`UPDATE artworks SET deleted_at = now() WHERE id = $1`, [DELETED]);

    // Mixed event types on VERIFIED: 2 default (published), 1 technical (expanded published),
    // 1 attestation (expanded published), 1 admin_note DRAFT (unpublished — must never surface).
    await insertTimelineEvent(q, { artworkId: VERIFIED, eventType: 'fractionalization', occurredAt: '2026-01-01T00:00:00.000Z', summary: 'frac' });
    await insertTimelineEvent(q, { artworkId: VERIFIED, eventType: 'secondary_trade', occurredAt: '2026-02-01T00:00:00.000Z', summary: 'trade', eventData: { fractionCount: '10', pricePerFractionStroops: '500', settledAt: '2026-02-01T00:00:00.000Z', txHash: 'SECRET' } });
    await insertTimelineEvent(q, { artworkId: VERIFIED, eventType: 'technical', occurredAt: '2026-03-01T00:00:00.000Z', summary: 're-anchor' });
    await insertTimelineEvent(q, { artworkId: VERIFIED, eventType: 'attestation', occurredAt: '2026-04-01T00:00:00.000Z', summary: 'attest' });
    await insertTimelineEvent(q, { artworkId: VERIFIED, eventType: 'admin_note', isPublished: false, occurredAt: '2026-05-01T00:00:00.000Z', summary: 'draft' });
  });

  it('Gherkin #1: default view shows only default-visible types + additional_events_count of hidden events', async () => {
    const res = await get(`/api/v1/artworks/${VERIFIED}/timeline`);
    expect(res.status).toBe(200);
    const body = res.body as Body;
    const events = body.events as Event[];
    expect(events.map((e) => e.eventType).sort()).toEqual(['fractionalization', 'secondary_trade']);
    expect(events.every((e) => e.visibilityTier === 'default')).toBe(true);
    // additional_events_count reflects the hidden PUBLISHED expanded events (technical + attestation = 2);
    // the unpublished admin_note draft is NOT counted.
    expect(body.additionalEventsCount).toBe(2);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('Gherkin #2: expand=true returns all published events in chronological order', async () => {
    const res = await get(`/api/v1/artworks/${VERIFIED}/timeline?expand=true`);
    expect(res.status).toBe(200);
    const body = res.body as Body;
    const events = body.events as Event[];
    // 4 published (frac, trade, technical, attestation); the admin_note draft stays hidden even with expand.
    expect(events.map((e) => e.eventType)).toEqual(['attestation', 'technical', 'secondary_trade', 'fractionalization']);
    expect(events.some((e) => e.eventType === 'admin_note')).toBe(false);
    expect(body.additionalEventsCount).toBe(0);
  });

  it('never leaks txHash on a public secondary_trade event (negative — deanonymization)', async () => {
    const res = await get(`/api/v1/artworks/${VERIFIED}/timeline`);
    const events = (res.body as Body).events as Event[];
    const trade = events.find((e) => e.eventType === 'secondary_trade');
    expect(trade?.metadata).toMatchObject({ fractionCount: '10', pricePerFractionStroops: '500' });
    expect(trade?.metadata.txHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('SECRET');
  });

  it('visible artwork with zero events → 200 empty envelope (edge, not 404)', async () => {
    const res = await get(`/api/v1/artworks/${EMPTY}/timeline`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ events: [], additionalEventsCount: 0, nextCursor: null });
  });

  it('404 matrix returns an identical body for hidden / soft-deleted / non-UUID / nonexistent (negative)', async () => {
    const published = await get(`/api/v1/artworks/${PUBLISHED}/timeline`);
    const deleted = await get(`/api/v1/artworks/${DELETED}/timeline`);
    const nonUuid = await get(`/api/v1/artworks/not-a-uuid/timeline`);
    const missing = await get(`/api/v1/artworks/00000000-0000-4000-8000-0000000effff/timeline`);
    for (const r of [published, deleted, nonUuid, missing]) {
      expect(r.status).toBe(404);
      expect((r.body as Body).errorCode).toBe('ARTWORK_NOT_FOUND');
    }
    expect(stableBody(deleted.body as Body)).toEqual(stableBody(published.body as Body));
    expect(stableBody(nonUuid.body as Body)).toEqual(stableBody(missing.body as Body));
  });

  // A valid-base64url but semantically tampered cursor: passes the DTO charset guard, reaches the service,
  // and fails decodeCursor. (A charset-invalid cursor 400s at the ValidationPipe regardless of artwork.)
  const TAMPERED = Buffer.from('tampered-not-json', 'utf8').toString('base64url');

  it('a hidden artwork with a tampered cursor still 404s (edge — visibility 404 wins over cursor 400)', async () => {
    const res = await get(`/api/v1/artworks/${PUBLISHED}/timeline?cursor=${TAMPERED}`);
    expect(res.status).toBe(404);
    expect((res.body as Body).errorCode).toBe('ARTWORK_NOT_FOUND');
  });

  it('tampered cursor on a visible artwork → 400 TIMELINE_INVALID_CURSOR (negative)', async () => {
    const res = await get(`/api/v1/artworks/${VERIFIED}/timeline?cursor=${TAMPERED}`);
    expect(res.status).toBe(400);
    expect((res.body as Body).errorCode).toBe('TIMELINE_INVALID_CURSOR');
  });

  it('out-of-Date-range cursor `o` → 400, never a 500 (#399, edge)', async () => {
    const huge = Buffer.from(
      JSON.stringify({ v: 1, o: 1e16, i: '00000000-0000-4000-8000-00000000c001' }),
      'utf8',
    ).toString('base64url');
    const res = await get(`/api/v1/artworks/${VERIFIED}/timeline?cursor=${huge}`);
    expect(res.status).toBe(400);
    expect((res.body as Body).errorCode).toBe('TIMELINE_INVALID_CURSOR');
  });

  it('invalid query params are rejected (negative): limit>50, non-boolean expand', async () => {
    expect((await get(`/api/v1/artworks/${VERIFIED}/timeline?limit=999`)).status).toBe(400);
    expect((await get(`/api/v1/artworks/${VERIFIED}/timeline?limit=0`)).status).toBe(400);
    expect((await get(`/api/v1/artworks/${VERIFIED}/timeline?expand=maybe`)).status).toBe(400);
  });

  it('cursor pagination walks all pages to exhaustion with no dup/gap (positive/edge)', async () => {
    const seen: string[] = [];
    let url = `/api/v1/artworks/${VERIFIED}/timeline?expand=true&limit=1`;
    for (let guard = 0; guard < 10; guard++) {
      const res = await get(url);
      expect(res.status).toBe(200);
      const body = res.body as Body;
      const events = body.events as Event[];
      seen.push(...events.map((e) => e.id));
      const next = body.nextCursor as string | null;
      if (!next) break;
      url = `/api/v1/artworks/${VERIFIED}/timeline?expand=true&limit=1&cursor=${encodeURIComponent(next)}`;
    }
    expect(seen).toHaveLength(4); // all published events
    expect(new Set(seen).size).toBe(4); // no duplicates
  });

  it('is anonymous: a bogus bearer still returns 200 (@Public)', async () => {
    const res = await get(`/api/v1/artworks/${VERIFIED}/timeline`).set('Authorization', 'Bearer bogus');
    expect(res.status).toBe(200);
  });
});
