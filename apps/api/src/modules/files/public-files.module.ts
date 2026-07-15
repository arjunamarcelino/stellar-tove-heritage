import { Module } from '@nestjs/common';
import { FilesModule } from './files.module';
import { FilesProxyController } from './files-proxy.controller';

/**
 * Public file-access surface. Serves the unauthenticated proxy controller under
 * the public API prefix (`api/v1/files/...`) on top of the shared files domain.
 */
@Module({
  imports: [FilesModule],
  controllers: [FilesProxyController],
})
export class PublicFilesModule {}
