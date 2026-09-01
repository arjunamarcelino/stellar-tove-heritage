import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { MeNotificationsService } from '../../../../src/modules/marketplace/notifications/me-notifications.service';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import type { NotificationRow } from '../../../../src/modules/marketplace/notifications/repositories/rfq-notification-repository.interface';

const SUB = '00000000-0000-4000-8000-00000000c002';
const NOTIF_ID = '00000000-0000-4000-8000-0000000e0001';

const errorCodeOf = (err: unknown): string | undefined =>
  err instanceof HttpException ? (err.getResponse() as { errorCode?: string }).errorCode : undefined;
const statusOf = (err: unknown): number | undefined =>
  err instanceof HttpException ? err.getStatus() : undefined;

const ROW: NotificationRow = {
  id: NOTIF_ID,
  rfqId: '00000000-0000-4000-8000-0000000f0001',
  artworkId: '00000000-0000-4000-8000-0000000a0001',
  artworkTitle: 'Untitled No. 4',
  artworkImageUrl: null,
  fractionCount: '100',
  maxPricePerFractionStroops: '150000000',
  rfqStatus: 'open',
  rfqExpiresAt: new Date('2026-08-24T12:00:00Z'),
  readAt: null,
  createdAt: new Date('2026-08-21T12:00:00Z'),
};

function build(over: { rows?: [NotificationRow[], number]; markRead?: boolean; rowById?: NotificationRow | null } = {}) {
  const repo = {
    listForRecipient: vi.fn(() => Promise.resolve(over.rows ?? [[ROW], 1])),
    countUnreadForRecipient: vi.fn(() => Promise.resolve(7)),
    markRead: vi.fn(() => Promise.resolve(over.markRead ?? true)),
    findRowById: vi.fn(() => Promise.resolve('rowById' in over ? over.rowById : ROW)),
  };
  return { service: new MeNotificationsService(repo as never), repo };
}

describe('MeNotificationsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list maps rows to DTOs (derived slug, no collector_sub) and passes filter=unread through', async () => {
    const { service, repo } = build();
    const res = await service.list(SUB, { page: 1, limit: 10, filter: 'unread' });
    expect(repo.listForRecipient).toHaveBeenCalledWith(SUB, { page: 1, limit: 10, unread: true });
    expect(res.meta).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 });
    expect(res.data[0]).toMatchObject({
      id: NOTIF_ID,
      artworkSlug: 'untitled-no-4-00000000',
      maxPricePerFractionStroops: '150000000',
      rfqStatus: 'open',
      readAt: null,
    });
    expect(res.data[0]).not.toHaveProperty('collectorSub');
  });

  it('filter=all (or omitted) lists everything (unread:false)', async () => {
    const { service, repo } = build();
    await service.list(SUB, { page: 2, limit: 5, filter: 'all' });
    expect(repo.listForRecipient).toHaveBeenCalledWith(SUB, { page: 2, limit: 5, unread: false });
  });

  it('unreadCount returns the bounded count', async () => {
    const { service, repo } = build();
    await expect(service.unreadCount(SUB)).resolves.toEqual({ count: 7 });
    expect(repo.countUnreadForRecipient).toHaveBeenCalledWith(SUB, 100);
  });

  it('markRead flips then returns the current joined row (just-flipped)', async () => {
    const { service, repo } = build({ markRead: true, rowById: { ...ROW, readAt: new Date('2026-08-21T13:00:00Z') } });
    const res = await service.markRead(SUB, NOTIF_ID);
    expect(repo.markRead).toHaveBeenCalledWith(NOTIF_ID, SUB);
    expect(res.readAt).toBe(new Date('2026-08-21T13:00:00Z').toISOString());
  });

  it('markRead is idempotent: already-read (no flip) still returns 200 with the unchanged row', async () => {
    const readRow = { ...ROW, readAt: new Date('2026-08-21T13:00:00Z') };
    const { service } = build({ markRead: false, rowById: readRow });
    const res = await service.markRead(SUB, NOTIF_ID);
    expect(res.readAt).toBe(readRow.readAt.toISOString());
  });

  it('markRead on a missing / not-owned notification → 404 NOTIFICATION_NOT_FOUND (no oracle)', async () => {
    const { service } = build({ markRead: false, rowById: null });
    const err = await service.markRead(SUB, NOTIF_ID).catch((e: unknown) => e);
    expect(statusOf(err)).toBe(404);
    expect(errorCodeOf(err)).toBe(ErrorCode.NOTIFICATION_NOT_FOUND);
  });
});
