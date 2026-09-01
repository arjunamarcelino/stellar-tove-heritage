import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileEntity } from './entities/file.entity';
import { FileRepository } from './repositories/file.repository';
import { FilesService } from './files.service';
import { StorageModule } from '@modules/storage/storage.module';

/**
 * Neutral files domain — the entity, repository, and `FilesService`. Owned by
 * neither API surface. Imported by both `PublicFilesModule` (public proxy
 * controller) and `BackofficeFilesModule` (guarded admin controller), which
 * declare their own controllers on top of this shared service.
 */
@Module({
  imports: [TypeOrmModule.forFeature([FileEntity]), StorageModule],
  providers: [
    { provide: 'IFileRepository', useClass: FileRepository },
    FilesService,
  ],
  exports: [FilesService],
})
export class FilesModule {}
