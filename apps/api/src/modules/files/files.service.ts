import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { IBaseRepository } from '@common/repositories/base-repository.interface';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { isUniqueConstraintError } from '@common/utils/database.utils';
import { filesConfig } from '@config/files.config';
import { FileEntity } from './entities/file.entity';
import { IFileRepository } from './repositories/file-repository.interface';
import { IStorageService } from '@modules/storage/storage-service.interface';
import { CreateFileDto } from './dto/create-file.dto';
import { UpdateFileDto } from './dto/update-file.dto';
import { FileResponseDto } from './dto/file-response.dto';
import { FileUrlResponseDto } from './dto/file-url-response.dto';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @Inject('IFileRepository')
    private readonly fileRepository: IBaseRepository<FileEntity> & IFileRepository,
    @Inject('IStorageService')
    private readonly storageService: IStorageService,
    @Inject(filesConfig.KEY)
    private readonly files: ConfigType<typeof filesConfig>,
  ) {}

  async findAll(page: number, limit: number): Promise<PaginatedResponseDto<FileResponseDto>> {
    const [files, total] = await this.fileRepository.findWithPagination(
      { order: { createdAt: 'DESC' } },
      page,
      limit,
    );
    return PaginatedResponseDto.create(
      files.map((file) => FileResponseDto.fromEntity(file)),
      total,
      page,
      limit,
    );
  }

  async findOneById(id: string): Promise<FileResponseDto> {
    const file = await this.fileRepository.findOneById(id);
    if (!file) {
      throw new NotFoundException('Resource not found');
    }
    return FileResponseDto.fromEntity(file);
  }

  async create(
    dto: CreateFileDto,
    file: Express.Multer.File,
    adminId: string,
  ): Promise<FileResponseDto> {
    this.validatePdfFile(file);

    const storagePath = `${randomUUID()}.pdf`;

    await this.storageService.upload(storagePath, file.buffer, 'application/pdf');

    try {
      const entity = this.fileRepository.create({
        title: dto.title,
        urlPath: dto.urlPath,
        storagePath,
        fileSize: file.size,
        originalFilename: file.originalname.replace(/[<>&"']/g, '_').slice(0, 255),
        isActive: true,
        createdBy: adminId,
      });
      const saved = await this.fileRepository.save(entity);
      return FileResponseDto.fromEntity(saved);
    } catch (err) {
      await this.storageService.delete(storagePath).catch((deleteErr) => {
        this.logger.error(`Failed to clean up orphaned file ${storagePath}`, deleteErr);
      });

      if (isUniqueConstraintError(err)) {
        throw new ConflictException('A file with this URL path already exists');
      }
      throw err;
    }
  }

  async update(
    id: string,
    dto: UpdateFileDto,
    file: Express.Multer.File | undefined,
    adminId: string,
  ): Promise<FileResponseDto> {
    const entity = await this.fileRepository.findOneById(id);
    if (!entity) {
      throw new NotFoundException('Resource not found');
    }

    let newStoragePath: string | undefined;
    const oldStoragePath = entity.storagePath;

    if (file) {
      this.validatePdfFile(file);
      newStoragePath = `${randomUUID()}.pdf`;
      await this.storageService.upload(newStoragePath, file.buffer, 'application/pdf');
      entity.storagePath = newStoragePath;
      entity.fileSize = file.size;
      entity.originalFilename = file.originalname.replace(/[<>&"']/g, '_').slice(0, 255);
    }

    if (dto.title !== undefined) entity.title = dto.title;
    if (dto.urlPath !== undefined) entity.urlPath = dto.urlPath;
    if (dto.isActive !== undefined) entity.isActive = dto.isActive;
    entity.updatedBy = adminId;

    try {
      const saved = await this.fileRepository.save(entity);

      if (newStoragePath && oldStoragePath !== newStoragePath) {
        await this.storageService.delete(oldStoragePath).catch((deleteErr) => {
          this.logger.warn(`Failed to delete old file ${oldStoragePath}`, deleteErr);
        });
      }

      return FileResponseDto.fromEntity(saved);
    } catch (err) {
      if (newStoragePath) {
        await this.storageService.delete(newStoragePath).catch((deleteErr) => {
          this.logger.error(`Failed to clean up orphaned file ${newStoragePath}`, deleteErr);
        });
      }

      if (isUniqueConstraintError(err)) {
        throw new ConflictException('A file with this URL path already exists');
      }
      throw err;
    }
  }

  async softDelete(id: string): Promise<void> {
    const entity = await this.fileRepository.findOneById(id);
    if (!entity) {
      throw new NotFoundException('Resource not found');
    }

    const storagePath = entity.storagePath;
    await this.fileRepository.softRemove(entity);

    await this.storageService.delete(storagePath).catch((err) => {
      this.logger.error(`Failed to delete file from storage: ${storagePath}`, err);
    });
  }

  async getFileUrl(urlPath: string): Promise<FileUrlResponseDto> {
    const file = await this.fileRepository.findActiveByUrlPath(urlPath);
    if (!file) {
      throw new NotFoundException();
    }

    const expiresIn = this.files.signedUrlTtl;
    const url = await this.storageService.createTemporaryUrl(file.storagePath, expiresIn);

    return FileUrlResponseDto.create({
      url,
      expiresIn,
      filename: file.originalFilename,
      fileSize: file.fileSize,
    });
  }

  private validatePdfFile(file: Express.Multer.File): void {
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Only PDF files are allowed');
    }
    const header = file.buffer.subarray(0, 5).toString('ascii');
    if (header !== '%PDF-') {
      throw new BadRequestException('Invalid PDF file');
    }
  }

}
