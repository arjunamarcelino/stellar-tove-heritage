import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { KycOrphanSweepService } from '@modules/kyc/sweep/kyc-orphan-sweep.service';
import { KYC_STORAGE } from '@modules/kyc/kyc.util';
import { KycDocument } from '@modules/kyc/entities/kyc-document.entity';
import { kycConfig } from '@config/kyc.config';

describe('KycOrphanSweepService', () => {
  let service: KycOrphanSweepService;
  let storage: { listObjectsOlderThan: Mock; delete: Mock };
  let documents: { find: Mock };

  beforeEach(async () => {
    storage = { listObjectsOlderThan: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) };
    documents = { find: vi.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycOrphanSweepService,
        { provide: KYC_STORAGE, useValue: storage },
        { provide: getRepositoryToken(KycDocument), useValue: documents },
        { provide: kycConfig.KEY, useValue: { orphanGraceHours: 48 } },
      ],
    }).compile();
    service = module.get(KycOrphanSweepService);
  });

  it('deletes objects with no kyc_documents row and keeps the known ones', async () => {
    storage.listObjectsOlderThan.mockResolvedValue([
      'u1/s1/selfie',
      'u1/s1/gov_id_front',
      'ghost/x/selfie', // orphan — no DB row
    ]);
    documents.find.mockResolvedValue([{ storageKey: 'u1/s1/selfie' }, { storageKey: 'u1/s1/gov_id_front' }]);

    const result = await service.sweep();

    expect(result).toEqual({ scanned: 3, orphans: 1, deleted: 1 });
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith('ghost/x/selfie');
  });

  it('scans only objects older than the grace window', async () => {
    storage.listObjectsOlderThan.mockResolvedValue([]);
    await service.sweep();
    expect(storage.listObjectsOlderThan).toHaveBeenCalledWith('', 48 * 60 * 60 * 1000);
  });

  it('no-ops (no DB query, no delete) when nothing is old enough', async () => {
    storage.listObjectsOlderThan.mockResolvedValue([]);
    const result = await service.sweep();
    expect(result).toEqual({ scanned: 0, orphans: 0, deleted: 0 });
    expect(documents.find).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('treats soft-deleted document blobs as retained (not orphans)', async () => {
    storage.listObjectsOlderThan.mockResolvedValue(['u1/s1/selfie']);
    documents.find.mockResolvedValue([{ storageKey: 'u1/s1/selfie' }]); // returned via withDeleted
    await service.sweep();
    expect(documents.find).toHaveBeenCalledWith(expect.objectContaining({ withDeleted: true }));
    expect(storage.delete).not.toHaveBeenCalled();
  });
});
