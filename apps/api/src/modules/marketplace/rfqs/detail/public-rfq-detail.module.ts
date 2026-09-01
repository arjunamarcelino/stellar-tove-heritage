import { Module } from '@nestjs/common';
import { RfqsModule } from '../rfqs.module';
import { QuotesModule } from '../../quotes/quotes.module';
import { FractionalizationModule } from '../../../fractionalization/fractionalization.module';
import { RfqDetailController } from './rfq-detail.controller';
import { RfqDetailService } from './rfq-detail.service';

/**
 * Public authenticated RFQ-detail surface (TOV-177, unblocks TOV-178): `GET marketplace/rfqs/:id` — the
 * buyer's own RFQ + its open quotes with the derived `acceptable` flag. Imports the neutral `RfqsModule`
 * (`RFQ_REPOSITORY`), `QuotesModule` (`QUOTE_REPOSITORY`, the open-quotes read), and `FractionalizationModule`
 * (`ARTWORK_REPOSITORY`, for the derived `artworkSlug`). Added to `PUBLIC_MODULES`. Pure DB read.
 */
@Module({
  imports: [RfqsModule, QuotesModule, FractionalizationModule],
  controllers: [RfqDetailController],
  providers: [RfqDetailService],
})
export class PublicRfqDetailModule {}
