import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { createTestingModule, truncateTables } from '../../setup';
import { TimelineModule } from '@modules/timeline/timeline.module';
import {
  TIMELINE_READ_REPOSITORY,
  type ITimelineReadRepository,
} from '@modules/timeline/repositories/timeline-read-repository.interface';
import { decodeCursor, encodeCursor } from '@modules/timeline/timeline-cursor';
import { insertArtwork, insertArtworkArtist } from '../../../shared/seed-artwork';
import { insertTimelineEvent } from '../../../shared/seed-timeline';

const ARTIST = '00000000-0000-4000-8000-0000000f1890';
const ART = '00000000-0000-4000-8000-0000000f0001';
const HIDDEN = '00000000-0000-4000-8000-0000000f0002';

describe('TimelineReadRepository (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let repo: ITimelineReadRepository;

  beforeAll(async () => {
    moduleRef = await createTestingModule(TimelineModule);
    dataSource = moduleRef.get(DataSource);
    repo = moduleRef.get<ITimelineReadRepository>(TIMELINE_READ_REPOSITORY);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const q = (text: string, params?: unknown[]) => dataSource.query(text, params);

  beforeEach(async () => {
    await truncateTables(dataSource); // clears the registered artwork_timeline_events
    // The minimal test module doesn't register users/artworks/fraction_contracts, so truncateTables can't
    // reach them — cascade-clear from users (→ artworks → fraction_contracts → timeline events).
    await q(`TRUNCATE TABLE "users" CASCADE`);
    await insertArtworkArtist(q, ARTIST);
    await insertArtwork(q, { id: ART, artistUserId: ARTIST, status: 'verified' });
    await insertArtwork(q, { id: HIDDEN, artistUserId: ARTIST, status: 'published' });
  });

  it('existsVisibleArtwork gates on status + soft-delete (positive/negative)', async () => {
    expect(await repo.existsVisibleArtwork(ART)).toBe(true);
    expect(await repo.existsVisibleArtwork(HIDDEN)).toBe(false);
    expect(await repo.existsVisibleArtwork('00000000-0000-4000-8000-0000000fffff')).toBe(false);
  });

  it('default view hides expanded tier; expand=true reveals it (positive)', async () => {
    await insertTimelineEvent(q, { artworkId: ART, eventType: 'fractionalization', occurredAt: '2026-01-01T00:00:00.000Z' });
    await insertTimelineEvent(q, { artworkId: ART, eventType: 'secondary_trade', occurredAt: '2026-01-02T00:00:00.000Z' });
    await insertTimelineEvent(q, { artworkId: ART, eventType: 'technical', occurredAt: '2026-01-03T00:00:00.000Z' });
    await insertTimelineEvent(q, { artworkId: ART, eventType: 'attestation', occurredAt: '2026-01-04T00:00:00.000Z' });

    const def = await repo.page({ artworkId: ART, expand: false, limit: 20 });
    expect(def.events.map((e) => e.eventType).sort()).toEqual(['fractionalization', 'secondary_trade']);
    expect(def.events.every((e) => e.visibilityTier === 'default')).toBe(true);

    const exp = await repo.page({ artworkId: ART, expand: true, limit: 20 });
    expect(exp.events).toHaveLength(4);
    // newest-first
    expect(exp.events.map((e) => e.eventType)).toEqual(['attestation', 'technical', 'secondary_trade', 'fractionalization']);
  });

  it('excludes unpublished events from BOTH views (negative)', async () => {
    await insertTimelineEvent(q, { artworkId: ART, eventType: 'admin_note', isPublished: false });
    await insertTimelineEvent(q, { artworkId: ART, eventType: 'condition_report', isPublished: false });
    expect((await repo.page({ artworkId: ART, expand: false, limit: 20 })).events).toHaveLength(0);
    expect((await repo.page({ artworkId: ART, expand: true, limit: 20 })).events).toHaveLength(0);
  });

  it('countExpanded = published expanded total, page-independent (positive)', async () => {
    await insertTimelineEvent(q, { artworkId: ART, eventType: 'technical' });
    await insertTimelineEvent(q, { artworkId: ART, eventType: 'attestation' });
    await insertTimelineEvent(q, { artworkId: ART, eventType: 'admin_note', isPublished: true });
    await insertTimelineEvent(q, { artworkId: ART, eventType: 'admin_note', isPublished: false }); // excluded
    await insertTimelineEvent(q, { artworkId: ART, eventType: 'fractionalization' }); // default tier, excluded
    expect(await repo.countExpanded(ART)).toBe(3);
  });

  it('keyset paging covers all rows with no dup/gap across same-occurred_at ties (edge)', async () => {
    // 5 events, TWO sharing the exact same occurred_at → the id tiebreak must keep paging deterministic.
    const tie = '2026-05-05T05:05:05.000Z';
    await insertTimelineEvent(q, { artworkId: ART, eventType: 'fractionalization', occurredAt: '2026-01-01T00:00:00.000Z', sourceRef: 'e1' });
    await insertTimelineEvent(q, { artworkId: ART, eventType: 'secondary_trade', occurredAt: tie, sourceRef: 'e2' });
    await insertTimelineEvent(q, { artworkId: ART, eventType: 'secondary_trade', occurredAt: tie, sourceRef: 'e3' });
    await insertTimelineEvent(q, { artworkId: ART, eventType: 'exhibition', occurredAt: '2026-03-03T00:00:00.000Z', sourceRef: 'e4' });
    await insertTimelineEvent(q, { artworkId: ART, eventType: 'loan', occurredAt: '2026-04-04T00:00:00.000Z', sourceRef: 'e5' });

    const seen: string[] = [];
    let cursor: { occurredAtMs: number; id: string } | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = await repo.page({ artworkId: ART, expand: false, limit: 2, cursor });
      seen.push(...page.events.map((e) => e.id));
      if (!page.hasMore) break;
      const last = page.events[page.events.length - 1];
      cursor = { occurredAtMs: last.occurredAt.getTime(), id: last.id };
    }
    expect(seen).toHaveLength(5); // all rows
    expect(new Set(seen).size).toBe(5); // no duplicates
  });

  it('a real encode→decode cursor round-trip continues the page without overlap (positive)', async () => {
    await insertTimelineEvent(q, { artworkId: ART, eventType: 'fractionalization', occurredAt: '2026-02-01T00:00:00.000Z' });
    await insertTimelineEvent(q, { artworkId: ART, eventType: 'secondary_trade', occurredAt: '2026-01-01T00:00:00.000Z' });
    const first = await repo.page({ artworkId: ART, expand: false, limit: 1 });
    expect(first.hasMore).toBe(true);
    const last = first.events[0];
    // Actually round-trip through the opaque cursor (encode → decode) and feed the DECODED position back
    // into the read path — proving the wire cursor drives pagination, not a hand-built position object.
    const decoded = decodeCursor(encodeCursor({ occurredAtMs: last.occurredAt.getTime(), id: last.id }));
    const second = await repo.page({ artworkId: ART, expand: false, limit: 1, cursor: decoded });
    expect(second.events).toHaveLength(1);
    expect(second.events[0].id).not.toBe(last.id); // no overlap
    expect(second.hasMore).toBe(false);
  });

  it('empty timeline for a visible artwork → no events, no more (edge)', async () => {
    const page = await repo.page({ artworkId: ART, expand: false, limit: 20 });
    expect(page.events).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(await repo.countExpanded(ART)).toBe(0);
  });
});
