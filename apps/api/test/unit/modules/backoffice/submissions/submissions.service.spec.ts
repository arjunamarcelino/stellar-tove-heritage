import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { BackofficeSubmissionsService } from '@modules/backoffice/submissions/submissions.service';
import { Submission } from '@modules/submissions/entities/submission.entity';
import { SubmissionStatus } from '@common/enums/submission-status.enum';

const mockSubmission: Partial<Submission> = {
  id: '550e8400-e29b-41d4-a716-446655440040',
  userId: '550e8400-e29b-41d4-a716-446655440002',
  missionId: '550e8400-e29b-41d4-a716-446655440030',
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

describe('BackofficeSubmissionsService', () => {
  let service: BackofficeSubmissionsService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackofficeSubmissionsService,
        { provide: 'ISubmissionRepository', useValue: mockSubmissionRepository },
      ],
    }).compile();

    service = module.get<BackofficeSubmissionsService>(BackofficeSubmissionsService);
  });

  describe('findAll', () => {
    it('should return paginated submissions', async () => {
      const submissions = [mockSubmission as Submission];
      mockSubmissionRepository.findWithPagination.mockResolvedValue([submissions, 1]);

      const result = await service.findAll(1, 10, {});

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
    });

    it('should apply missionId filter', async () => {
      mockSubmissionRepository.findWithPagination.mockResolvedValue([[], 0]);
      const missionId = '550e8400-e29b-41d4-a716-446655440030';

      await service.findAll(1, 10, { missionId });

      expect(mockSubmissionRepository.findWithPagination).toHaveBeenCalledWith(
        { where: { missionId }, order: { createdAt: 'DESC' } },
        1,
        10,
      );
    });

    it('should apply status filter', async () => {
      mockSubmissionRepository.findWithPagination.mockResolvedValue([[], 0]);

      await service.findAll(1, 10, { status: SubmissionStatus.PENDING });

      expect(mockSubmissionRepository.findWithPagination).toHaveBeenCalledWith(
        { where: { status: SubmissionStatus.PENDING }, order: { createdAt: 'DESC' } },
        1,
        10,
      );
    });

    it('should apply userId filter', async () => {
      mockSubmissionRepository.findWithPagination.mockResolvedValue([[], 0]);
      const userId = '550e8400-e29b-41d4-a716-446655440002';

      await service.findAll(1, 10, { userId });

      expect(mockSubmissionRepository.findWithPagination).toHaveBeenCalledWith(
        { where: { userId }, order: { createdAt: 'DESC' } },
        1,
        10,
      );
    });
  });

  describe('findOneById', () => {
    it('should return a submission when found', async () => {
      mockSubmissionRepository.findOneById.mockResolvedValue(mockSubmission);

      const result = await service.findOneById(mockSubmission.id!);

      expect(result.id).toBe(mockSubmission.id);
      expect(result.status).toBe(SubmissionStatus.PENDING);
    });

    it('should throw NotFoundException when submission not found', async () => {
      mockSubmissionRepository.findOneById.mockResolvedValue(null);

      await expect(service.findOneById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('review', () => {
    const adminId = '550e8400-e29b-41d4-a716-446655440001';

    it('should approve a pending submission', async () => {
      const entity = { ...mockSubmission } as Submission;
      mockSubmissionRepository.findOneById.mockResolvedValue(entity);
      mockSubmissionRepository.save.mockImplementation((e: unknown) => Promise.resolve(e));

      const result = await service.review(
        mockSubmission.id!,
        { status: SubmissionStatus.ACCEPTED },
        adminId,
      );

      expect(result.status).toBe(SubmissionStatus.ACCEPTED);
      expect(entity.reviewedBy).toBe(adminId);
      expect(entity.reviewedAt).toBeInstanceOf(Date);
    });

    it('should reject a pending submission with admin notes', async () => {
      const entity = { ...mockSubmission } as Submission;
      mockSubmissionRepository.findOneById.mockResolvedValue(entity);
      mockSubmissionRepository.save.mockImplementation((e: unknown) => Promise.resolve(e));

      const result = await service.review(
        mockSubmission.id!,
        { status: SubmissionStatus.REJECTED, adminNotes: 'Invalid evidence' },
        adminId,
      );

      expect(result.status).toBe(SubmissionStatus.REJECTED);
      expect(result.adminNotes).toBe('Invalid evidence');
    });

    it('should throw NotFoundException when submission not found', async () => {
      mockSubmissionRepository.findOneById.mockResolvedValue(null);

      await expect(
        service.review('nonexistent', { status: SubmissionStatus.ACCEPTED }, adminId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when reviewing non-pending submission', async () => {
      const entity = { ...mockSubmission, status: SubmissionStatus.ACCEPTED } as Submission;
      mockSubmissionRepository.findOneById.mockResolvedValue(entity);

      await expect(
        service.review(mockSubmission.id!, { status: SubmissionStatus.REJECTED }, adminId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException on duplicate accepted submission', async () => {
      const entity = { ...mockSubmission } as Submission;
      mockSubmissionRepository.findOneById.mockResolvedValue(entity);
      mockSubmissionRepository.save.mockRejectedValue({ code: '23505' });

      await expect(
        service.review(mockSubmission.id!, { status: SubmissionStatus.ACCEPTED }, adminId),
      ).rejects.toThrow(ConflictException);
    });
  });
});
