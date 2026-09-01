import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { SubmissionsService } from '@modules/submissions/submissions.service';
import { Submission } from '@modules/submissions/entities/submission.entity';
import { Mission } from '@modules/backoffice/missions/entities/mission.entity';
import { EvidenceType } from '@common/enums/evidence-type.enum';
import { VerificationMethod } from '@common/enums/verification-method.enum';
import { SubmissionStatus } from '@common/enums/submission-status.enum';

const userId = '550e8400-e29b-41d4-a716-446655440002';

interface MockStage {
  id: string;
  title: string;
  order: number;
  isActive: boolean;
  startsAt: Date | null;
  readonly isEffectivelyActive: boolean;
}

const mockStage: MockStage = {
  id: '550e8400-e29b-41d4-a716-446655440020',
  title: 'Getting Started',
  order: 1,
  isActive: true,
  startsAt: null,
  get isEffectivelyActive(): boolean {
    if (!this.isActive) return false;
    if (this.startsAt && this.startsAt.getTime() > Date.now()) return false;
    return true;
  },
};

const mockMission: Partial<Mission> = {
  id: '550e8400-e29b-41d4-a716-446655440030',
  stageId: mockStage.id,
  title: 'Follow us on X',
  evidenceType: EvidenceType.URL,
  verificationMethod: VerificationMethod.MANUAL,
  isActive: true,
};

const mockSubmission: Partial<Submission> = {
  id: '550e8400-e29b-41d4-a716-446655440040',
  userId,
  missionId: mockMission.id!,
  status: SubmissionStatus.PENDING,
  fileUrl: null,
  linkUrl: 'https://x.com/tove_art',
  textContent: null,
  adminNotes: null,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
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

describe('SubmissionsService', () => {
  let service: SubmissionsService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubmissionsService,
        { provide: 'ISubmissionRepository', useValue: mockSubmissionRepository },
        { provide: 'IMissionRepository', useValue: mockMissionRepository },
        { provide: 'IStageRepository', useValue: mockStageRepository },
      ],
    }).compile();

    service = module.get<SubmissionsService>(SubmissionsService);
  });

  describe('submit', () => {
    const dto = { linkUrl: 'https://x.com/tove_art' };

    it('should create a submission successfully', async () => {
      mockMissionRepository.findOneById.mockResolvedValue(mockMission);
      mockStageRepository.findOneById.mockResolvedValue(mockStage);
      mockSubmissionRepository.findAccepted.mockResolvedValue(null);
      mockSubmissionRepository.findPending.mockResolvedValue(null);
      mockSubmissionRepository.create.mockReturnValue({ ...mockSubmission });
      mockSubmissionRepository.save.mockResolvedValue({ ...mockSubmission });

      const result = await service.submit(userId, mockMission.id!, dto);

      expect(result.id).toBe(mockSubmission.id);
      expect(result.status).toBe(SubmissionStatus.PENDING);
      expect(mockSubmissionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          missionId: mockMission.id,
          status: SubmissionStatus.PENDING,
        }),
      );
    });

    it('should throw NotFoundException when mission not found', async () => {
      mockMissionRepository.findOneById.mockResolvedValue(null);

      await expect(service.submit(userId, 'nonexistent', dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when mission is inactive', async () => {
      mockMissionRepository.findOneById.mockResolvedValue({ ...mockMission, isActive: false });

      await expect(service.submit(userId, mockMission.id!, dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when stage is not active', async () => {
      mockMissionRepository.findOneById.mockResolvedValue(mockMission);
      mockStageRepository.findOneById.mockResolvedValue({
        ...mockStage,
        isActive: false,
        get isEffectivelyActive() { return false; },
      });

      await expect(service.submit(userId, mockMission.id!, dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when stage has not started yet', async () => {
      mockMissionRepository.findOneById.mockResolvedValue(mockMission);
      const futureDate = new Date(Date.now() + 86400000);
      const futureStage: MockStage = {
        ...mockStage,
        startsAt: futureDate,
        get isEffectivelyActive(): boolean {
          if (!this.isActive) return false;
          if (this.startsAt && this.startsAt.getTime() > Date.now()) return false;
          return true;
        },
      };
      mockStageRepository.findOneById.mockResolvedValue(futureStage);

      await expect(service.submit(userId, mockMission.id!, dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException when user already has accepted submission', async () => {
      mockMissionRepository.findOneById.mockResolvedValue(mockMission);
      mockStageRepository.findOneById.mockResolvedValue(mockStage);
      mockSubmissionRepository.findAccepted.mockResolvedValue(mockSubmission);

      await expect(service.submit(userId, mockMission.id!, dto)).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException when user already has pending submission', async () => {
      mockMissionRepository.findOneById.mockResolvedValue(mockMission);
      mockStageRepository.findOneById.mockResolvedValue(mockStage);
      mockSubmissionRepository.findAccepted.mockResolvedValue(null);
      mockSubmissionRepository.findPending.mockResolvedValue(mockSubmission);

      await expect(service.submit(userId, mockMission.id!, dto)).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException for URL mission without linkUrl', async () => {
      mockMissionRepository.findOneById.mockResolvedValue(mockMission);
      mockStageRepository.findOneById.mockResolvedValue(mockStage);
      mockSubmissionRepository.findAccepted.mockResolvedValue(null);
      mockSubmissionRepository.findPending.mockResolvedValue(null);

      await expect(service.submit(userId, mockMission.id!, {})).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for TEXT mission without textContent', async () => {
      const textMission = { ...mockMission, evidenceType: EvidenceType.TEXT };
      mockMissionRepository.findOneById.mockResolvedValue(textMission);
      mockStageRepository.findOneById.mockResolvedValue(mockStage);
      mockSubmissionRepository.findAccepted.mockResolvedValue(null);
      mockSubmissionRepository.findPending.mockResolvedValue(null);

      await expect(
        service.submit(userId, mockMission.id!, { linkUrl: 'https://example.com' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle race condition via unique constraint catch', async () => {
      mockMissionRepository.findOneById.mockResolvedValue(mockMission);
      mockStageRepository.findOneById.mockResolvedValue(mockStage);
      mockSubmissionRepository.findAccepted.mockResolvedValue(null);
      mockSubmissionRepository.findPending.mockResolvedValue(null);
      mockSubmissionRepository.create.mockReturnValue({ ...mockSubmission });
      mockSubmissionRepository.save.mockRejectedValue({ code: '23505' });

      await expect(service.submit(userId, mockMission.id!, dto)).rejects.toThrow(ConflictException);
    });

    it('should rethrow non-unique-constraint errors on save', async () => {
      mockMissionRepository.findOneById.mockResolvedValue(mockMission);
      mockStageRepository.findOneById.mockResolvedValue(mockStage);
      mockSubmissionRepository.findAccepted.mockResolvedValue(null);
      mockSubmissionRepository.findPending.mockResolvedValue(null);
      mockSubmissionRepository.create.mockReturnValue({ ...mockSubmission });
      const genericError = new Error('connection lost');
      mockSubmissionRepository.save.mockRejectedValue(genericError);

      await expect(service.submit(userId, mockMission.id!, dto)).rejects.toThrow(genericError);
    });
  });

  describe('findAllByUser', () => {
    it('should return paginated submissions for a user', async () => {
      const submissions = [mockSubmission as Submission];
      mockSubmissionRepository.findWithPagination.mockResolvedValue([submissions, 1]);

      const result = await service.findAllByUser(userId, 1, 10);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(mockSubmissionRepository.findWithPagination).toHaveBeenCalledWith(
        { where: { userId }, order: { createdAt: 'DESC' } },
        1,
        10,
      );
    });
  });
});
