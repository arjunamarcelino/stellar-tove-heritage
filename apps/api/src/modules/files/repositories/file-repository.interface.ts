import { FileEntity } from '../entities/file.entity';

export interface IFileRepository {
  findByUrlPath(urlPath: string): Promise<FileEntity | null>;
  findActiveByUrlPath(urlPath: string): Promise<FileEntity | null>;
}
