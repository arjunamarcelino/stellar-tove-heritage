import { Module } from '@nestjs/common';
import { TimelineModule } from './timeline.module';
import { TimelineController } from './timeline.controller';
import { TimelineService } from './timeline.service';

/**
 * Public read surface for the artwork timeline (TOV-191). Imports the neutral `TimelineModule` for the read
 * repository token and declares the anonymous `@Controller('artworks')` timeline route. Registered in
 * `PUBLIC_MODULES` (only this controller-bearing module is — the neutral module is imported by workers).
 */
@Module({
  imports: [TimelineModule],
  controllers: [TimelineController],
  providers: [TimelineService],
})
export class PublicTimelineModule {}
