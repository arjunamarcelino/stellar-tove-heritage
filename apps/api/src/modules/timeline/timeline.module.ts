import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArtworkTimelineEvent } from './entities/artwork-timeline-event.entity';
import { TIMELINE_READ_REPOSITORY } from './repositories/timeline-read-repository.interface';
import { TimelineReadRepository } from './repositories/timeline-read.repository';
import { TimelineEmitService } from './timeline-emit.service';

/**
 * Neutral timeline domain (TOV-191). Owns the `ArtworkTimelineEvent` entity, the read repository, and the
 * best-effort `TimelineEmitService`. Deliberately has NO controller — the public read surface lives in
 * `PublicTimelineModule`; the write-domain workers (`fractionalization` deploy, marketplace `settlement`)
 * import THIS neutral module for the emit service, so importing emit never drags a public controller into a
 * non-routed graph (the neutral/public split, like `WalletsAuditModule` / `SettlementModule`).
 *
 * Registers only its own entity via `forFeature`; the read/emit paths reach `artworks`/`fraction_contracts`
 * via raw `DataSource` SQL (no cross-domain module import, no Soroban bootstrap).
 */
@Module({
  imports: [TypeOrmModule.forFeature([ArtworkTimelineEvent])],
  providers: [
    { provide: TIMELINE_READ_REPOSITORY, useClass: TimelineReadRepository },
    TimelineEmitService,
  ],
  exports: [TIMELINE_READ_REPOSITORY, TimelineEmitService],
})
export class TimelineModule {}
