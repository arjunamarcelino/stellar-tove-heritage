import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { StagesService } from '@modules/backoffice/stages/stages.service';
import { Stage } from '@modules/backoffice/stages/entities/stage.entity';

const mockStage: Partial<Stage> = {
  id: '550e8400-e29b-41d4-a716-446655440020',
  title: 'Getting Started',
  description: 'Complete introductory tasks',
  order: 1,
  isActive: true,
  startsAt: null,
  createdBy: '550e8400-e29b-41d4-a716-446655440001',
  updatedBy: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
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
  runInTransaction: vi.fn((work: (manager: unknown) => Promise<unknown>) => {
    const mockManager = { softRemove: vi.fn() };
    return work(mockManager);
  }),
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

describe('StagesService', () => {
  let service: StagesService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StagesService,
        { provide: 'IStageRepository', useValue: mockStageRepository },
        { provide: 'IMissionRepository', useValue: mockMissionRepository },
      ],
    }).compile();

    service = module.get<StagesService>(StagesService);
  });

  describe('findAll', () => {
    it('should return paginated stages ordered by order ASC', async () => {
      const stages = [mockStage as Stage];
      mockStageRepository.findWithPagination.mockResolvedValue([stages, 1]);

      const result = await service.findAll(1, 10);

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
      expect(mockStageRepository.findWithPagination).toHaveBeenCalledWith(
        { order: { order: 'ASC' } },
        1,
        10,
      );
    });
  });

  describe('findOneById', () => {
    it('should return a stage when found', async () => {
      mockStageRepository.findOneById.mockResolvedValue(mockStage);

      const result = await service.findOneById(mockStage.id!);

      expect(result.id).toBe(mockStage.id);
      expect(result.title).toBe(mockStage.title);
    });

    it('should throw NotFoundException when stage not found', async () => {
      mockStageRepository.findOneById.mockResolvedValue(null);

      await expect(service.findOneById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    const dto = { title: 'New Stage', order: 2 };
    const adminId = '550e8400-e29b-41d4-a716-446655440001';

    it('should create and save a stage', async () => {
      mockStageRepository.create.mockReturnValue({ ...mockStage, title: dto.title, order: dto.order });
      mockStageRepository.save.mockResolvedValue({ ...mockStage, title: dto.title, order: dto.order });

      const result = await service.create(dto, adminId);

      expect(result.title).toBe(dto.title);
      expect(mockStageRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: dto.title,
          order: dto.order,
          createdBy: adminId,
        }),
      );
    });

    it('should throw ConflictException on duplicate order', async () => {
      mockStageRepository.create.mockReturnValue({ ...mockStage });
      mockStageRepository.save.mockRejectedValue({ code: '23505' });

      await expect(service.create(dto, adminId)).rejects.toThrow(ConflictException);
    });

    it('should rethrow non-unique-constraint errors', async () => {
      mockStageRepository.create.mockReturnValue({ ...mockStage });
      const genericError = new Error('connection lost');
      mockStageRepository.save.mockRejectedValue(genericError);

      await expect(service.create(dto, adminId)).rejects.toThrow(genericError);
    });

    it('should default isActive to false when not provided', async () => {
      mockStageRepository.create.mockReturnValue({ ...mockStage });
      mockStageRepository.save.mockResolvedValue({ ...mockStage });

      await service.create(dto, adminId);

      expect(mockStageRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });
  });

  describe('update', () => {
    const adminId = '550e8400-e29b-41d4-a716-446655440001';

    it('should update stage fields', async () => {
      const entity = { ...mockStage } as Stage;
      mockStageRepository.findOneById.mockResolvedValue(entity);
      mockStageRepository.save.mockImplementation((e: unknown) => Promise.resolve(e));

      const result = await service.update(mockStage.id!, { title: 'Updated' }, adminId);

      expect(result.title).toBe('Updated');
      expect(entity.updatedBy).toBe(adminId);
    });

    it('should throw NotFoundException when stage not found', async () => {
      mockStageRepository.findOneById.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', { title: 'X' }, adminId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException on duplicate order', async () => {
      const entity = { ...mockStage } as Stage;
      mockStageRepository.findOneById.mockResolvedValue(entity);
      mockStageRepository.save.mockRejectedValue({ code: '23505' });

      await expect(
        service.update(mockStage.id!, { order: 1 }, adminId),
      ).rejects.toThrow(ConflictException);
    });

    it('should update isActive flag', async () => {
      const entity = { ...mockStage, isActive: true } as Stage;
      mockStageRepository.findOneById.mockResolvedValue(entity);
      mockStageRepository.save.mockImplementation((e: unknown) => Promise.resolve(e));

      const result = await service.update(mockStage.id!, { isActive: false }, adminId);

      expect(result.isActive).toBe(false);
    });
  });

  describe('softDelete', () => {
    it('should soft-remove stage and its missions in a transaction', async () => {
      const entity = { ...mockStage } as Stage;
      const missions = [{ id: 'mission-1' }, { id: 'mission-2' }];
      mockStageRepository.findOneById.mockResolvedValue(entity);
      mockMissionRepository.findByStageId.mockResolvedValue(missions);

      await service.softDelete(mockStage.id!);

      expect(mockMissionRepository.findByStageId).toHaveBeenCalledWith(mockStage.id);
      expect(mockStageRepository.runInTransaction).toHaveBeenCalled();
    });

    it('should soft-remove stage without missions when none exist', async () => {
      const entity = { ...mockStage } as Stage;
      mockStageRepository.findOneById.mockResolvedValue(entity);
      mockMissionRepository.findByStageId.mockResolvedValue([]);

      await service.softDelete(mockStage.id!);

      expect(mockStageRepository.runInTransaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException when stage not found', async () => {
      mockStageRepository.findOneById.mockResolvedValue(null);

      await expect(service.softDelete('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
