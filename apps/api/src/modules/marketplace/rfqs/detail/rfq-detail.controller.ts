import { Controller, Get, Header, Param, ParseUUIDPipe } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RfqDetailService } from './rfq-detail.service';
import { RfqDetailResponseDto } from './dto/rfq-detail-response.dto';

// Shares the `marketplace/rfqs` base path with RfqsController / QuotesController (sibling modules) — no
// collision: this is the only `GET :id` route. Owner-scoped read (the buyer's own RFQ). TOV-177 / unblocks TOV-178.
@ApiTags('Marketplace RFQ detail')
@ApiBearerAuth()
@Controller('marketplace/rfqs')
export class RfqDetailController {
  constructor(private readonly service: RfqDetailService) {}

  @Get(':id')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: "List the caller's RFQ detail + its open quotes (price ASC, per-row acceptable)" })
  @ApiOkResponse({ type: RfqDetailResponseDto })
  getDetail(
    @Param('id', new ParseUUIDPipe()) rfqId: string,
    @CurrentUser('sub') userId: string,
  ): Promise<RfqDetailResponseDto> {
    return this.service.getDetail(userId, rfqId);
  }
}
