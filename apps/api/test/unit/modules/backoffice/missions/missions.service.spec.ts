import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { MissionsService } from '@modules/backoffice/missions/missions.service';
import { Mission } from '@modules/backoffice/missions/entities/mission.entity';
import { Stage } from '@modules/backoffice/stages/entities/stage.entity';
import { EvidenceType } from '@common/enums/evidence-type.enum';
import { VerificationMethod } from '@common/enums/verification-method.enum';

const mockStage: Partial<Stage> = {
  id: '550e8400-e29b-41d4-a716-446655440020',
  title: 'Getting Started',
  order: 1,
  isActive: true,
};

const mockMission: Partial<Mission> = {
  id: '550e8400-e29b-41d4-a716-446655440030',
  stageId: mockStage.id!,
  title: 'Follow us on X',
  description: 'Follow @tove_art on X',
  order: 1,
  evidenceType: EvidenceType.URL,
  verificationMethod: VerificationMethod.MANUAL,
  verificationConfig: null,
  isActive: true,
  createdBy: '550e8400-e29b-41d4-a716-446655440001',
  updatedBy: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
};

const mockMissionRepository = {
  create: vi.fn(),
  save: vi.fn(),
  saveMany: vi.fn(),
  findOneById: vi.fn(),
  findOne: vi.fn(),
  findAll: vi.fn(),
  findWithPagination: vi.fn(),
  update: vi.fn(),
  softRemove: vi.fn(),
  count: vi.fn(),
  exists: vi.fn(),
  findByStageId: vi.fn(),
};

const mockStageRepository = {
  create: vi.fn(),
  save: vi.fn(),
  saveMany: vi.fn(),
  findOneById: vi.fn(),
  findOne: vi.fn(),
  findAll: vi.fn(),
  findWithPagination: vi.fn(),
  update: vi.fn(),
  softRemove: vi.fn(),
  count: vi.fn(),
  exists: vi.fn(),
};

describe('MissionsService', () => {
  let service: MissionsService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissionsService,
        { provide: 'IMissionRepository', useValue: mockMissionRepository },
        { provide: 'IStageRepository', useValue: mockStageRepository },
      ],
    }).compile();

    service = module.get<MissionsService>(MissionsService);
  });

  describe('findAll', () => {
    it('should return paginated missions ordered by order ASC', async () => {
      const missions = [mockMission as Mission];
      mockMissionRepository.findWithPagination.mockResolvedValue([missions, 1]);

      const result = await service.findAll(1, 10);

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
      expect(mockMissionRepository.findWithPagination).toHaveBeenCalledWith(
        { where: {}, order: { order: 'ASC' } },
        1,
        10,
      );
    });

    it('should filter by stageId when provided', async () => {
      mockMissionRepository.findWithPagination.mockResolvedValue([[], 0]);

      await service.findAll(1, 10, mockStage.id);

      expect(mockMissionRepository.findWithPagination).toHaveBeenCalledWith(
        { where: { stageId: mockStage.id }, order: { order: 'ASC' } },
        1,
        10,
      );
    });
  });

  describe('findOneById', () => {
    it('should return a mission when found', async () => {
      mockMissionRepository.findOneById.mockResolvedValue(mockMission);

      const result = await service.findOneById(mockMission.id!);

      expect(result.id).toBe(mockMission.id);
      expect(result.title).toBe(mockMission.title);
    });

    it('should throw NotFoundException when mission not found', async () => {
      mockMissionRepository.findOneById.mockResolvedValue(null);

      await expect(service.findOneById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    const dto = {
      stageId: mockStage.id!,
      title: 'New Mission',
      order: 2,
      evidenceType: EvidenceType.URL,
    };
    const adminId = '550e8400-e29b-41d4-a716-446655440001';

    it('should validate stage exists and create mission', async () => {
      mockStageRepository.findOneById.mockResolvedValue(mockStage);
      mockMissionRepository.create.mockReturnValue({ ...mockMission, title: dto.title });
      mockMissionRepository.save.mockResolvedValue({ ...mockMission, title: dto.title });

      const result = await service.create(dto, adminId);

      expect(result.title).toBe(dto.title);
      expect(mockStageRepository.findOneById).toHaveBeenCalledWith(dto.stageId);
      expect(mockMissionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          stageId: dto.stageId,
          title: dto.title,
          createdBy: adminId,
        }),
      );
    });

    it('should throw NotFoundException when stage does not exist', async () => {
      mockStageRepository.findOneById.mockResolvedValue(null);

      await expect(service.create(dto, adminId)).rejects.toThrow(NotFoundException);
      expect(mockMissionRepository.create).not.toHaveBeenCalled();
    });

    it('should throw ConflictException on duplicate order within stage', async () => {
      mockStageRepository.findOneById.mockResolvedValue(mockStage);
      mockMissionRepository.create.mockReturnValue({ ...mockMission });
      mockMissionRepository.save.mockRejectedValue({ code: '23505' });

      await expect(service.create(dto, adminId)).rejects.toThrow(ConflictException);
    });

    it('should rethrow non-unique-constraint errors', async () => {
      mockStageRepository.findOneById.mockResolvedValue(mockStage);
      mockMissionRepository.create.mockReturnValue({ ...mockMission });
      const genericError = new Error('connection lost');
      mockMissionRepository.save.mockRejectedValue(genericError);

      await expect(service.create(dto, adminId)).rejects.toThrow(genericError);
    });

    it('should default verificationMethod to MANUAL', async () => {
      mockStageRepository.findOneById.mockResolvedValue(mockStage);
      mockMissionRepository.create.mockReturnValue({ ...mockMission });
      mockMissionRepository.save.mockResolvedValue({ ...mockMission });

      await service.create(dto, adminId);

      expect(mockMissionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ verificationMethod: VerificationMethod.MANUAL }),
      );
    });
  });

  describe('update', () => {
    const adminId = '550e8400-e29b-41d4-a716-446655440001';

    it('should update mission fields', async () => {
      const entity = { ...mockMission } as Mission;
      mockMissionRepository.findOneById.mockResolvedValue(entity);
      mockMissionRepository.save.mockImplementation((e: unknown) => Promise.resolve(e));

      const result = await service.update(mockMission.id!, { title: 'Updated' }, adminId);

      expect(result.title).toBe('Updated');
      expect(entity.updatedBy).toBe(adminId);
    });

    it('should throw NotFoundException when mission not found', async () => {
      mockMissionRepository.findOneById.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', { title: 'X' }, adminId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException on duplicate order', async () => {
      const entity = { ...mockMission } as Mission;
      mockMissionRepository.findOneById.mockResolvedValue(entity);
      mockMissionRepository.save.mockRejectedValue({ code: '23505' });

      await expect(
        service.update(mockMission.id!, { order: 1 }, adminId),
      ).rejects.toThrow(ConflictException);
    });

    it('should update verificationConfig', async () => {
      const entity = { ...mockMission } as Mission;
      mockMissionRepository.findOneById.mockResolvedValue(entity);
      mockMissionRepository.save.mockImplementation((e: unknown) => Promise.resolve(e));

      const config = { targetUsername: 'tove_art' };
      const result = await service.update(
        mockMission.id!,
        { verificationConfig: config },
        adminId,
      );

      expect(result.verificationConfig).toEqual(config);
    });
  });

  describe('softDelete', () => {
    it('should soft-remove the mission', async () => {
      const entity = { ...mockMission } as Mission;
      mockMissionRepository.findOneById.mockResolvedValue(entity);
      mockMissionRepository.softRemove.mockResolvedValue({ ...entity, deletedAt: new Date() });

      await service.softDelete(mockMission.id!);

      expect(mockMissionRepository.softRemove).toHaveBeenCalledWith(entity);
    });

    it('should throw NotFoundException when mission not found', async () => {
      mockMissionRepository.findOneById.mockResolvedValue(null);

      await expect(service.softDelete('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
