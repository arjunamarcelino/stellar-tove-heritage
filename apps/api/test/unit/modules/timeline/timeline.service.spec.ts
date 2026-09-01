import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { TimelineService } from '@modules/timeline/timeline.service';
import { encodeCursor } from '@modules/timeline/timeline-cursor';
import type { TimelineEventRecord } from '@modules/timeline/repositories/timeline-read-repository.interface';
import type { TimelineQueryDto } from '@modules/timeline/dto/timeline-query.dto';

const VISIBLE = '00000000-0000-4000-8000-0000000f0001';

// Property-typed (arrow) function mocks so referencing them in `expect(...)` doesn't trip unbound-method.
interface MockRepo {
  existsVisibleArtwork: Mock;
  page: Mock;
  countExpanded: Mock;
}

function record(over: Partial<TimelineEventRecord> = {}): TimelineEventRecord {
  return {
    id: over.id ?? '00000000-0000-4000-8000-00000000e001',
    eventType: over.eventType ?? 'fractionalization',
    visibilityTier: over.visibilityTier ?? 'default',
    occurredAt: over.occurredAt ?? new Date('2026-08-24T10:00:00.000Z'),
    summary: over.summary ?? 'summary',
    eventData: over.eventData ?? {},
  };
}

function makeRepo(): MockRepo {
  return {
    existsVisibleArtwork: vi.fn().mockResolvedValue(true),
    page: vi.fn().mockResolvedValue({ events: [], hasMore: false }),
    countExpanded: vi.fn().mockResolvedValue(0),
  };
}

const svc = (repo: MockRepo): TimelineService =>
  new TimelineService(repo);

const query = (over: Partial<TimelineQueryDto> = {}): TimelineQueryDto =>
  ({ expand: false, limit: 20, ...over });

describe('TimelineService', () => {
  let repo: MockRepo;
  let service: TimelineService;

  beforeEach(() => {
    repo = makeRepo();
    service = svc(repo);
  });

  it('404s a non-UUID id WITHOUT hitting the DB (negative, no 22P02)', async () => {
    await expect(service.getTimeline('not-a-uuid', query())).rejects.toThrow(NotFoundException);
    expect(repo.existsVisibleArtwork).not.toHaveBeenCalled();
  });

  it('404s a non-visible artwork (negative)', async () => {
    repo.existsVisibleArtwork.mockResolvedValue(false);
    await expect(service.getTimeline(VISIBLE, query())).rejects.toThrow(NotFoundException);
    expect(repo.page).not.toHaveBeenCalled();
  });

  it('returns default-view events + additionalEventsCount (positive)', async () => {
    repo.page.mockResolvedValue({ events: [record()], hasMore: false });
    repo.countExpanded.mockResolvedValue(3);
    const res = await service.getTimeline(VISIBLE, query());
    expect(res.events).toHaveLength(1);
    expect(res.additionalEventsCount).toBe(3);
    expect(res.nextCursor).toBeNull();
    expect(repo.page).toHaveBeenCalledWith({ artworkId: VISIBLE, expand: false, limit: 20, cursor: undefined });
  });

  it('expand=true → additionalEventsCount 0, countExpanded NOT queried (edge)', async () => {
    repo.page.mockResolvedValue({ events: [record({ visibilityTier: 'expanded' })], hasMore: false });
    const res = await service.getTimeline(VISIBLE, query({ expand: true }));
    expect(res.additionalEventsCount).toBe(0);
    expect(repo.countExpanded).not.toHaveBeenCalled();
  });

  it('emits nextCursor from the last event when hasMore (positive)', async () => {
    const last = record({ id: '00000000-0000-4000-8000-00000000e099', occurredAt: new Date('2026-01-01T00:00:00.000Z') });
    repo.page.mockResolvedValue({ events: [record(), last], hasMore: true });
    const res = await service.getTimeline(VISIBLE, query());
    expect(res.nextCursor).toBe(encodeCursor({ occurredAtMs: last.occurredAt.getTime(), id: last.id }));
  });

  it('decodes a valid cursor and forwards the position to the repo (positive)', async () => {
    const cursor = encodeCursor({ occurredAtMs: 1_750_000_000_000, id: '00000000-0000-4000-8000-00000000c001' });
    await service.getTimeline(VISIBLE, query({ cursor }));
    expect(repo.page).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { occurredAtMs: 1_750_000_000_000, id: '00000000-0000-4000-8000-00000000c001' } }),
    );
  });

  it('countExpanded is NOT recomputed on a paginated (cursor) page → additionalEventsCount 0 (edge, #403)', async () => {
    const cursor = encodeCursor({ occurredAtMs: 1_750_000_000_000, id: '00000000-0000-4000-8000-00000000c001' });
    const res = await service.getTimeline(VISIBLE, query({ cursor }));
    expect(res.additionalEventsCount).toBe(0);
    expect(repo.countExpanded).not.toHaveBeenCalled();
  });

  it('a malformed cursor 400s — but only AFTER the visibility 404 gate (edge, precedence)', async () => {
    // Visible artwork + bad cursor → 400.
    await expect(service.getTimeline(VISIBLE, query({ cursor: '###' }))).rejects.toThrow(BadRequestException);
    // Hidden artwork + bad cursor → 404 wins (no cursor oracle for a hidden artwork).
    repo.existsVisibleArtwork.mockResolvedValue(false);
    await expect(service.getTimeline(VISIBLE, query({ cursor: '###' }))).rejects.toThrow(NotFoundException);
  });
});
