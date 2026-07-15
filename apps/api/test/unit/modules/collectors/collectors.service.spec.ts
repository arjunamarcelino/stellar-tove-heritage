import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CollectorsService } from '@modules/collectors/collectors.service';
import { IUserRepository } from '@modules/users/repositories/user-repository.interface';
import { User } from '@modules/users/entities/user.entity';
import { HandleHistory } from '@modules/users/entities/handle-history.entity';

/** Build a User stub with just the fields the service reads. */
function user(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    handle: 'Carol',
    handleCanonical: 'carol',
    handleHistoryPublic: true,
    createdAt: new Date('2026-01-15T09:00:00.000Z'),
    ...overrides,
  } as User;
}

/** Build a history row (newest-first order is the repo's responsibility; tests pass them pre-ordered). */
function row(handle: string): HandleHistory {
  return { handle, handleCanonical: handle.toLowerCase() } as HandleHistory;
}

describe('CollectorsService', () => {
  let users: { findPublicProfileByHandleCanonical: ReturnType<typeof vi.fn> };
  let history: { listByUserId: ReturnType<typeof vi.fn> };
  let service: CollectorsService;

  beforeEach(() => {
    users = { findPublicProfileByHandleCanonical: vi.fn() };
    history = { listByUserId: vi.fn() };
    service = new CollectorsService(
      users as unknown as IUserRepository,
      history,
    );
  });

  it('returns handle + createdAt (ISO string) + empty previousHandles on first-ever handle', async () => {
    users.findPublicProfileByHandleCanonical.mockResolvedValue(user());
    history.listByUserId.mockResolvedValue([row('Carol')]); // only the current handle in history
    const res = await service.getProfile('carol');
    expect(res).toEqual({ handle: 'Carol', previousHandles: [], createdAt: '2026-01-15' }); // date only
  });

  it('excludes the current canonical and dedups, newest-occurrence-first (A→B→A→C ⇒ [A,B])', async () => {
    users.findPublicProfileByHandleCanonical.mockResolvedValue(user({ handle: 'C', handleCanonical: 'c' }));
    // newest-first: C(now), A(t3), B(t2), A(t1)
    history.listByUserId.mockResolvedValue([row('C'), row('A'), row('B'), row('A')]);
    const res = await service.getProfile('c');
    expect(res.previousHandles).toEqual(['A', 'B']);
  });

  it('excludes ALL rows matching the current canonical (A→C→B→C ⇒ [B,A])', async () => {
    users.findPublicProfileByHandleCanonical.mockResolvedValue(user({ handle: 'C', handleCanonical: 'c' }));
    // newest-first: C(t4), B(t3), C(t2), A(t1)
    history.listByUserId.mockResolvedValue([row('C'), row('B'), row('C'), row('A')]);
    const res = await service.getProfile('C');
    expect(res.previousHandles).toEqual(['B', 'A']);
  });

  it('dedups case-insensitively by canonical (keeps the most-recent display casing)', async () => {
    users.findPublicProfileByHandleCanonical.mockResolvedValue(user({ handle: 'Carol', handleCanonical: 'carol' }));
    history.listByUserId.mockResolvedValue([row('Carol'), row('Bob'), row('BOB')]);
    const res = await service.getProfile('carol');
    expect(res.previousHandles).toEqual(['Bob']); // first (newest) occurrence's casing wins
  });

  it('fails safe to [] (and skips the history read) if the current canonical is unexpectedly null', async () => {
    users.findPublicProfileByHandleCanonical.mockResolvedValue(user({ handleCanonical: null }));
    const res = await service.getProfile('carol');
    expect(res.previousHandles).toEqual([]);
    expect(history.listByUserId).not.toHaveBeenCalled();
  });

  it('returns [] and never reads history when the collector opted out', async () => {
    users.findPublicProfileByHandleCanonical.mockResolvedValue(user({ handleHistoryPublic: false }));
    const res = await service.getProfile('carol');
    expect(res.previousHandles).toEqual([]);
    expect(history.listByUserId).not.toHaveBeenCalled();
  });

  it('throws COLLECTOR_NOT_FOUND (404) when no live collector matches', async () => {
    users.findPublicProfileByHandleCanonical.mockResolvedValue(null);
    await expect(service.getProfile('nobody')).rejects.toMatchObject({
      status: 404,
      response: { errorCode: 'COLLECTOR_NOT_FOUND' },
    });
  });

  it('short-circuits an over-length handle to 404 without querying the DB', async () => {
    await expect(service.getProfile('x'.repeat(25))).rejects.toMatchObject({
      response: { errorCode: 'COLLECTOR_NOT_FOUND' },
    });
    expect(users.findPublicProfileByHandleCanonical).not.toHaveBeenCalled();
  });

  it('resolves case-insensitively (trims + lowercases the raw param)', async () => {
    users.findPublicProfileByHandleCanonical.mockResolvedValue(user());
    history.listByUserId.mockResolvedValue([row('Carol')]);
    await service.getProfile('  CAROL  ');
    expect(users.findPublicProfileByHandleCanonical).toHaveBeenCalledWith('carol');
  });
});
