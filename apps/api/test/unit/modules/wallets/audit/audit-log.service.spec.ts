import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { AuditLogService } from '../../../../../src/modules/wallets/audit/audit-log.service';
import { AUDIT_KIND } from '../../../../../src/modules/wallets/audit/audit-log.types';

describe('AuditLogService', () => {
  let repo: { record: ReturnType<typeof vi.fn> };
  let service: AuditLogService;

  beforeEach(() => {
    repo = { record: vi.fn().mockResolvedValue(undefined) };
    service = new AuditLogService(repo);
  });

  it('appends a row via the repository', async () => {
    await service.record({
      actorType: 'user',
      actorId: 'user-1',
      kind: AUDIT_KIND.EXPORT_REQUESTED,
      subjectType: 'wallet_export',
      subjectId: 'exp-1',
      payload: { target: 'G...' },
    });
    expect(repo.record).toHaveBeenCalledOnce();
    expect(repo.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'wallet.export.requested', actorId: 'user-1' }),
    );
  });

  it('propagates the transactional manager for a confirm-time atomic write', async () => {
    const manager = {} as EntityManager;
    await service.record(
      { actorType: 'system', kind: AUDIT_KIND.EXPORT_CONFIRMED, subjectType: 'wallet_export', subjectId: 'exp-1' },
      manager,
    );
    expect(repo.record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'wallet.export.confirmed' }), manager);
  });

  it('swallows a non-transactional audit failure (never fails the money action)', async () => {
    repo.record.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.record({ actorType: 'user', kind: AUDIT_KIND.EXPORT_SUBMIT, subjectType: 'wallet_export', subjectId: 'e' }),
    ).resolves.toBeUndefined();
  });

  it('re-throws a transactional audit failure (rolls back with the side effect)', async () => {
    const manager = {} as EntityManager;
    repo.record.mockRejectedValueOnce(new Error('constraint'));
    await expect(
      service.record(
        { actorType: 'system', kind: AUDIT_KIND.EXPORT_CONFIRMED, subjectType: 'wallet_export', subjectId: 'e' },
        manager,
      ),
    ).rejects.toThrow('constraint');
  });
});
