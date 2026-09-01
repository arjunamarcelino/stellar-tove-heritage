import { ApiProperty } from '@nestjs/swagger';
import { TimelineEventResponseDto } from './timeline-event-response.dto';
import type { TimelineEventRecord } from '../repositories/timeline-read-repository.interface';

export class TimelineResponseDto {
  @ApiProperty({ type: [TimelineEventResponseDto] })
  events!: TimelineEventResponseDto[];

  @ApiProperty({
    description: 'Whole-artwork total of published expanded-tier events (0 when expand=true)',
    example: 3,
  })
  additionalEventsCount!: number;

  @ApiProperty({ type: String, nullable: true, description: 'Opaque cursor for the next page; null when last' })
  nextCursor!: string | null;

  static build(
    events: readonly TimelineEventRecord[],
    additionalEventsCount: number,
    nextCursor: string | null,
  ): TimelineResponseDto {
    const dto = new TimelineResponseDto();
    dto.events = events.map((event) => TimelineEventResponseDto.from(event));
    dto.additionalEventsCount = additionalEventsCount;
    dto.nextCursor = nextCursor;
    return dto;
  }
}
