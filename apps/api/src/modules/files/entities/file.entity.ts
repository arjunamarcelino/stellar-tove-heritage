import { Entity, Column } from 'typeorm';
import { BaseEntity } from '@common/entities/base.entity';

@Entity('files')
export class FileEntity extends BaseEntity {
  @Column({ name: 'title', type: 'varchar', length: 255 })
  title!: string;

  @Column({ name: 'url_path', type: 'varchar', length: 255 })
  urlPath!: string;

  @Column({ name: 'storage_path', type: 'varchar', length: 512 })
  storagePath!: string;

  @Column({ name: 'file_size', type: 'integer' })
  fileSize!: number;

  @Column({ name: 'original_filename', type: 'varchar', length: 255 })
  originalFilename!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;
}
