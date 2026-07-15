import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Readable } from 'stream';
import { FilesService } from '@modules/files/files.service';
import { FileEntity } from '@modules/files/entities/file.entity';
import { FileUrlResponseDto } from '@modules/files/dto/file-url-response.dto';
import { filesConfig } from '@config/files.config';

const mockFile: Partial<FileEntity> = {
  id: '550e8400-e29b-41d4-a716-446655440010',
  title: 'Test Document',
  urlPath: 'test-document',
  storagePath: 'abc-uuid.pdf',
  fileSize: 1024,
  originalFilename: 'test.pdf',
  isActive: true,
  createdBy: '550e8400-e29b-41d4-a716-446655440001',
  updatedBy: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
};

const mockFileRepository = {
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
  findByUrlPath: vi.fn(),
  findActiveByUrlPath: vi.fn(),
};

const mockStorageService = {
  upload: vi.fn(),
  createTemporaryUrl: vi.fn(),
  delete: vi.fn(),
};

function createMulterFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  const pdfHeader = Buffer.from('%PDF-1.4 test content');
  return {
    fieldname: 'file',
    originalname: 'test.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    buffer: pdfHeader,
    size: pdfHeader.length,
    stream: Readable.from(pdfHeader),
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  };
}

describe('FilesService', () => {
  let service: FilesService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: 'IFileRepository', useValue: mockFileRepository },
        { provide: 'IStorageService', useValue: mockStorageService },
        { provide: filesConfig.KEY, useValue: { signedUrlTtl: 3600 } },
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
  });

  describe('findAll', () => {
    it('should return paginated files', async () => {
      const files = [mockFile as FileEntity];
      mockFileRepository.findWithPagination.mockResolvedValue([files, 1]);

      const result = await service.findAll(1, 10);

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
      expect(mockFileRepository.findWithPagination).toHaveBeenCalledWith(
        { order: { createdAt: 'DESC' } },
        1,
        10,
      );
    });
  });

  describe('findOneById', () => {
    it('should return a file when found', async () => {
      mockFileRepository.findOneById.mockResolvedValue(mockFile);

      const result = await service.findOneById(mockFile.id!);

      expect(result.id).toBe(mockFile.id);
      expect(result.title).toBe(mockFile.title);
    });

    it('should throw NotFoundException when file not found', async () => {
      mockFileRepository.findOneById.mockResolvedValue(null);

      await expect(service.findOneById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    const dto = { title: 'New Doc', urlPath: 'new-doc' };
    const adminId = '550e8400-e29b-41d4-a716-446655440001';

    it('should upload file to storage and save entity', async () => {
      const multerFile = createMulterFile();
      mockStorageService.upload.mockResolvedValue(undefined);
      mockFileRepository.create.mockReturnValue({ ...mockFile });
      mockFileRepository.save.mockResolvedValue({ ...mockFile, title: dto.title });

      const result = await service.create(dto, multerFile, adminId);

      expect(result.title).toBe(dto.title);
      expect(mockStorageService.upload).toHaveBeenCalledWith(
        expect.stringContaining('.pdf'),
        multerFile.buffer,
        'application/pdf',
      );
      expect(mockFileRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: dto.title,
          urlPath: dto.urlPath,
          isActive: true,
          createdBy: adminId,
        }),
      );
    });

    it('should reject non-PDF mimetype', async () => {
      const multerFile = createMulterFile({ mimetype: 'image/png' });

      await expect(service.create(dto, multerFile, adminId)).rejects.toThrow(BadRequestException);
      expect(mockStorageService.upload).not.toHaveBeenCalled();
    });

    it('should reject files without PDF magic bytes', async () => {
      const multerFile = createMulterFile({
        mimetype: 'application/pdf',
        buffer: Buffer.from('NOT-A-PDF file'),
      });

      await expect(service.create(dto, multerFile, adminId)).rejects.toThrow(BadRequestException);
      expect(mockStorageService.upload).not.toHaveBeenCalled();
    });

    it('should clean up storage on duplicate URL path conflict', async () => {
      const multerFile = createMulterFile();
      mockStorageService.upload.mockResolvedValue(undefined);
      mockFileRepository.create.mockReturnValue({ ...mockFile });
      mockFileRepository.save.mockRejectedValue({ code: '23505' });
      mockStorageService.delete.mockResolvedValue(undefined);

      await expect(service.create(dto, multerFile, adminId)).rejects.toThrow(ConflictException);
      expect(mockStorageService.delete).toHaveBeenCalled();
    });

    it('should log error but not throw if orphan cleanup fails', async () => {
      const multerFile = createMulterFile();
      mockStorageService.upload.mockResolvedValue(undefined);
      mockFileRepository.create.mockReturnValue({ ...mockFile });
      mockFileRepository.save.mockRejectedValue({ code: '23505' });
      mockStorageService.delete.mockRejectedValue(new Error('storage down'));

      await expect(service.create(dto, multerFile, adminId)).rejects.toThrow(ConflictException);
    });

    it('should rethrow non-unique-constraint errors', async () => {
      const multerFile = createMulterFile();
      mockStorageService.upload.mockResolvedValue(undefined);
      mockFileRepository.create.mockReturnValue({ ...mockFile });
      const genericError = new Error('connection lost');
      mockFileRepository.save.mockRejectedValue(genericError);
      mockStorageService.delete.mockResolvedValue(undefined);

      await expect(service.create(dto, multerFile, adminId)).rejects.toThrow(genericError);
    });
  });

  describe('update', () => {
    const adminId = '550e8400-e29b-41d4-a716-446655440001';

    it('should update metadata without file replacement', async () => {
      const entity = { ...mockFile } as FileEntity;
      mockFileRepository.findOneById.mockResolvedValue(entity);
      mockFileRepository.save.mockResolvedValue({ ...entity, title: 'Updated' });

      const result = await service.update(
        mockFile.id!,
        { title: 'Updated' },
        undefined,
        adminId,
      );

      expect(result.title).toBe('Updated');
      expect(mockStorageService.upload).not.toHaveBeenCalled();
      expect(mockStorageService.delete).not.toHaveBeenCalled();
    });

    it('should replace file in storage when new file provided', async () => {
      const entity = { ...mockFile } as FileEntity;
      const oldPath = entity.storagePath;
      mockFileRepository.findOneById.mockResolvedValue(entity);
      const multerFile = createMulterFile();
      mockStorageService.upload.mockResolvedValue(undefined);
      mockFileRepository.save.mockImplementation(
        (e: unknown) => Promise.resolve(e),
      );
      mockStorageService.delete.mockResolvedValue(undefined);

      await service.update(mockFile.id!, {}, multerFile, adminId);

      expect(mockStorageService.upload).toHaveBeenCalledWith(
        expect.stringContaining('.pdf'),
        multerFile.buffer,
        'application/pdf',
      );
      expect(mockStorageService.delete).toHaveBeenCalledWith(oldPath);
    });

    it('should throw NotFoundException when file not found', async () => {
      mockFileRepository.findOneById.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', { title: 'X' }, undefined, adminId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should clean up new file on save failure', async () => {
      const entity = { ...mockFile } as FileEntity;
      mockFileRepository.findOneById.mockResolvedValue(entity);
      const multerFile = createMulterFile();
      mockStorageService.upload.mockResolvedValue(undefined);
      mockFileRepository.save.mockRejectedValue({ code: '23505' });
      mockStorageService.delete.mockResolvedValue(undefined);

      await expect(
        service.update(mockFile.id!, { urlPath: 'existing-path' }, multerFile, adminId),
      ).rejects.toThrow(ConflictException);

      expect(mockStorageService.delete).toHaveBeenCalled();
    });

    it('should update isActive flag', async () => {
      const entity = { ...mockFile, isActive: true } as FileEntity;
      mockFileRepository.findOneById.mockResolvedValue(entity);
      mockFileRepository.save.mockImplementation(
        (e: unknown) => Promise.resolve(e),
      );

      const result = await service.update(mockFile.id!, { isActive: false }, undefined, adminId);

      expect(result.isActive).toBe(false);
    });

    it('should set updatedBy to the admin ID', async () => {
      const entity = { ...mockFile } as FileEntity;
      mockFileRepository.findOneById.mockResolvedValue(entity);
      mockFileRepository.save.mockImplementation(
        (e: unknown) => Promise.resolve(e),
      );

      await service.update(mockFile.id!, { title: 'X' }, undefined, adminId);

      expect(entity.updatedBy).toBe(adminId);
    });
  });

  describe('softDelete', () => {
    it('should soft-remove entity and delete from storage', async () => {
      const entity = { ...mockFile } as FileEntity;
      mockFileRepository.findOneById.mockResolvedValue(entity);
      mockFileRepository.softRemove.mockResolvedValue({ ...entity, deletedAt: new Date() });
      mockStorageService.delete.mockResolvedValue(undefined);

      await service.softDelete(mockFile.id!);

      expect(mockFileRepository.softRemove).toHaveBeenCalledWith(entity);
      expect(mockStorageService.delete).toHaveBeenCalledWith(entity.storagePath);
    });

    it('should throw NotFoundException when file not found', async () => {
      mockFileRepository.findOneById.mockResolvedValue(null);

      await expect(service.softDelete('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should not throw if storage deletion fails', async () => {
      const entity = { ...mockFile } as FileEntity;
      mockFileRepository.findOneById.mockResolvedValue(entity);
      mockFileRepository.softRemove.mockResolvedValue({ ...entity, deletedAt: new Date() });
      mockStorageService.delete.mockRejectedValue(new Error('storage error'));

      await expect(service.softDelete(mockFile.id!)).resolves.not.toThrow();
    });
  });

  describe('getFileUrl', () => {
    it('should return FileUrlResponseDto for active file', async () => {
      const entity = { ...mockFile } as FileEntity;
      mockFileRepository.findActiveByUrlPath.mockResolvedValue(entity);
      mockStorageService.createTemporaryUrl.mockResolvedValue(
        'https://example.supabase.co/storage/v1/object/sign/files/abc.pdf?token=xyz',
      );

      const result = await service.getFileUrl('test-document');

      expect(result).toBeInstanceOf(FileUrlResponseDto);
      expect(result.url).toBe(
        'https://example.supabase.co/storage/v1/object/sign/files/abc.pdf?token=xyz',
      );
      expect(result.expiresIn).toBe(3600);
      expect(result.filename).toBe(entity.originalFilename);
      expect(result.fileSize).toBe(entity.fileSize);
    });

    it('should call createTemporaryUrl with configured TTL', async () => {
      const entity = { ...mockFile } as FileEntity;
      mockFileRepository.findActiveByUrlPath.mockResolvedValue(entity);
      mockStorageService.createTemporaryUrl.mockResolvedValue('https://signed.url');

      await service.getFileUrl('test-document');

      expect(mockStorageService.createTemporaryUrl).toHaveBeenCalledWith(
        entity.storagePath,
        3600,
      );
    });

    it('should throw NotFoundException for non-existent URL path', async () => {
      mockFileRepository.findActiveByUrlPath.mockResolvedValue(null);

      await expect(service.getFileUrl('no-such-doc')).rejects.toThrow(NotFoundException);
    });

    it('should propagate storage errors', async () => {
      const entity = { ...mockFile } as FileEntity;
      mockFileRepository.findActiveByUrlPath.mockResolvedValue(entity);
      mockStorageService.createTemporaryUrl.mockRejectedValue(
        new InternalServerErrorException('Failed to generate file URL'),
      );

      await expect(service.getFileUrl('test-document')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
