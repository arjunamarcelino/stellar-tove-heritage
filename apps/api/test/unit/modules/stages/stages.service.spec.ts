import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UserStagesService } from '@modules/stages/stages.service';
import { Mission } from '@modules/backoffice/missions/entities/mission.entity';
import { EvidenceType } from '@common/enums/evidence-type.enum';
import { VerificationMethod } from '@common/enums/verification-method.enum';

const stageId1 = '550e8400-e29b-41d4-a716-446655440020';
const stageId2 = '550e8400-e29b-41d4-a716-446655440021';
const userId = '550e8400-e29b-41d4-a716-446655440002';

interface MockStage {
  id: string;
  title: string;
  description: string;
  order: number;
  isActive: boolean;
  startsAt: Date | null;
  createdBy: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  readonly isEffectivelyActive: boolean;
}

const mockStage1: MockStage = {
  id: stageId1,
  title: 'Getting Started',
  description: 'Introductory tasks',
  order: 1,
  isActive: true,
  startsAt: null,
  createdBy: '550e8400-e29b-41d4-a716-446655440001',
  updatedBy: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
  get isEffectivelyActive(): boolean {
    if (!this.isActive) return false;
    if (this.startsAt && this.startsAt.getTime() > Date.now()) return false;
    return true;
  },
};

const mockStage2: MockStage = {
  id: stageId2,
  title: 'Advanced',
  description: 'Advanced tasks',
  order: 2,
  isActive: false,
  startsAt: null,
  createdBy: '550e8400-e29b-41d4-a716-446655440001',
  updatedBy: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
  get isEffectivelyActive(): boolean {
    if (!this.isActive) return false;
    if (this.startsAt && this.startsAt.getTime() > Date.now()) return false;
    return true;
  },
};

const mockMission: Partial<Mission> = {
  id: '550e8400-e29b-41d4-a716-446655440030',
  stageId: stageId1,
  title: 'Follow us on X',
  order: 1,
  evidenceType: EvidenceType.URL,
  verificationMethod: VerificationMethod.MANUAL,
  isActive: true,
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
  countActiveMissionsByStageIds: vi.fn(),
};

const mockSubmissionRepository = {
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
  findAccepted: vi.fn(),
  findPending: vi.fn(),
  countCompletedMissionsByStageIds: vi.fn(),
};

describe('UserStagesService', () => {
  let service: UserStagesService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserStagesService,
        { provide: 'IStageRepository', useValue: mockStageRepository },
        { provide: 'IMissionRepository', useValue: mockMissionRepository },
        { provide: 'ISubmissionRepository', useValue: mockSubmissionRepository },
      ],
    }).compile();

    service = module.get<UserStagesService>(UserStagesService);
  });

  describe('getUserProgress', () => {
    it('should return progress for all stages', async () => {
      mockStageRepository.findAll.mockResolvedValue([mockStage1, mockStage2]);
      mockMissionRepository.countActiveMissionsByStageIds.mockResolvedValue(
        new Map([[stageId1, 2]]),
      );
      mockSubmissionRepository.countCompletedMissionsByStageIds.mockResolvedValue(
        new Map([[stageId1, 1]]),
      );

      const result = await service.getUserProgress(userId);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(stageId1);
      expect(result[0].totalMissions).toBe(2);
      expect(result[0].completedMissions).toBe(1);
      expect(result[0].isCompleted).toBe(false);
      expect(result[0].isEffectivelyActive).toBe(true);
      expect(result[1].id).toBe(stageId2);
      expect(result[1].totalMissions).toBe(0);
      expect(result[1].completedMissions).toBe(0);
      expect(result[1].isEffectivelyActive).toBe(false);
    });

    it('should return empty array when no stages exist', async () => {
      mockStageRepository.findAll.mockResolvedValue([]);

      const result = await service.getUserProgress(userId);

      expect(result).toEqual([]);
      expect(mockSubmissionRepository.countCompletedMissionsByStageIds).not.toHaveBeenCalled();
    });

    it('should mark stage as completed when all missions are done', async () => {
      mockStageRepository.findAll.mockResolvedValue([mockStage1]);
      mockMissionRepository.countActiveMissionsByStageIds.mockResolvedValue(
        new Map([[stageId1, 1]]),
      );
      mockSubmissionRepository.countCompletedMissionsByStageIds.mockResolvedValue(
        new Map([[stageId1, 1]]),
      );

      const result = await service.getUserProgress(userId);

      expect(result[0].isCompleted).toBe(true);
      expect(result[0].totalMissions).toBe(1);
      expect(result[0].completedMissions).toBe(1);
    });

    it('should handle stage with future startsAt as not effectively active', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      const futureStage: MockStage = {
        ...mockStage1,
        startsAt: futureDate,
        get isEffectivelyActive(): boolean {
          if (!this.isActive) return false;
          if (this.startsAt && this.startsAt.getTime() > Date.now()) return false;
          return true;
        },
      };
      mockStageRepository.findAll.mockResolvedValue([futureStage]);
      mockMissionRepository.countActiveMissionsByStageIds.mockResolvedValue(new Map());
      mockSubmissionRepository.countCompletedMissionsByStageIds.mockResolvedValue(new Map());

      const result = await service.getUserProgress(userId);

      expect(result[0].isEffectivelyActive).toBe(false);
    });
  });

  describe('getCurrentStage', () => {
    it('should return null when no stages exist', async () => {
      mockStageRepository.findAll.mockResolvedValue([]);

      const result = await service.getCurrentStage(userId);

      expect(result).toBeNull();
    });

    it('should return first active stage for new user (all incomplete)', async () => {
      const activeStage2: MockStage = {
        ...mockStage2,
        isActive: true,
        get isEffectivelyActive(): boolean {
          if (!this.isActive) return false;
          if (this.startsAt && this.startsAt.getTime() > Date.now()) return false;
          return true;
        },
      };
      mockStageRepository.findAll.mockResolvedValue([mockStage1, activeStage2]);
      mockMissionRepository.countActiveMissionsByStageIds.mockResolvedValue(
        new Map([
          [stageId1, 3],
          [stageId2, 2],
        ]),
      );
      mockSubmissionRepository.countCompletedMissionsByStageIds.mockResolvedValue(new Map());

      const result = await service.getCurrentStage(userId);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(stageId1);
      expect(result!.isCompleted).toBe(false);
    });

    it('should return first incomplete active stage for mid-progress user', async () => {
      const activeStage2: MockStage = {
        ...mockStage2,
        isActive: true,
        get isEffectivelyActive(): boolean {
          if (!this.isActive) return false;
          if (this.startsAt && this.startsAt.getTime() > Date.now()) return false;
          return true;
        },
      };
      mockStageRepository.findAll.mockResolvedValue([mockStage1, activeStage2]);
      mockMissionRepository.countActiveMissionsByStageIds.mockResolvedValue(
        new Map([
          [stageId1, 2],
          [stageId2, 3],
        ]),
      );
      mockSubmissionRepository.countCompletedMissionsByStageIds.mockResolvedValue(
        new Map([
          [stageId1, 2],
          [stageId2, 1],
        ]),
      );

      const result = await service.getCurrentStage(userId);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(stageId2);
      expect(result!.isCompleted).toBe(false);
    });

    it('should return last active stage when all are completed', async () => {
      const activeStage2: MockStage = {
        ...mockStage2,
        isActive: true,
        get isEffectivelyActive(): boolean {
          if (!this.isActive) return false;
          if (this.startsAt && this.startsAt.getTime() > Date.now()) return false;
          return true;
        },
      };
      mockStageRepository.findAll.mockResolvedValue([mockStage1, activeStage2]);
      mockMissionRepository.countActiveMissionsByStageIds.mockResolvedValue(
        new Map([
          [stageId1, 2],
          [stageId2, 3],
        ]),
      );
      mockSubmissionRepository.countCompletedMissionsByStageIds.mockResolvedValue(
        new Map([
          [stageId1, 2],
          [stageId2, 3],
        ]),
      );

      const result = await service.getCurrentStage(userId);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(stageId2);
      expect(result!.isCompleted).toBe(true);
    });
  });

  describe('getStageDetail', () => {
    it('should return stage detail with missions', async () => {
      mockStageRepository.findOneById.mockResolvedValue(mockStage1);
      mockMissionRepository.findByStageId.mockResolvedValue([mockMission as Mission]);
      mockMissionRepository.countActiveMissionsByStageIds.mockResolvedValue(
        new Map([[stageId1, 1]]),
      );
      mockSubmissionRepository.countCompletedMissionsByStageIds.mockResolvedValue(
        new Map([[stageId1, 0]]),
      );

      const result = await service.getStageDetail(userId, stageId1);

      expect(result.stage.id).toBe(stageId1);
      expect(result.stage.totalMissions).toBe(1);
      expect(result.stage.completedMissions).toBe(0);
      expect(result.missions).toHaveLength(1);
    });

    it('should throw NotFoundException when stage not found', async () => {
      mockStageRepository.findOneById.mockResolvedValue(null);

      await expect(service.getStageDetail(userId, 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
