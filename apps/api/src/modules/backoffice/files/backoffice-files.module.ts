import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FilesModule } from '@modules/files/files.module';
import { FilesController } from './files.controller';
import { BackofficeGuard } from '@common/guards/backoffice.guard';

/**
 * Backoffice file-management surface. Serves the guarded admin CRUD controller
 * under the backoffice prefix (`api/backoffice/v1/files`) on top of the shared
 * files domain (`FilesModule`).
 */
@Module({
  imports: [FilesModule, JwtModule.register({})],
  controllers: [FilesController],
  providers: [BackofficeGuard],
})
export class BackofficeFilesModule {}
