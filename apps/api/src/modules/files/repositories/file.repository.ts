import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { FileEntity } from '../entities/file.entity';
import { IFileRepository } from './file-repository.interface';

@Injectable()
export class FileRepository extends BaseRepository<FileEntity> implements IFileRepository {
  constructor(dataSource: DataSource) {
    super(FileEntity, dataSource);
  }

  async findByUrlPath(urlPath: string): Promise<FileEntity | null> {
    return this.repository.findOne({
      where: { urlPath },
    });
  }

  async findActiveByUrlPath(urlPath: string): Promise<FileEntity | null> {
    return this.repository.findOne({
      where: { urlPath, isActive: true },
    });
  }
}
