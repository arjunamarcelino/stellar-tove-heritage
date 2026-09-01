import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Quote } from './entities/quote.entity';
import { QUOTE_REPOSITORY } from './repositories/quote-repository.interface';
import { QuoteRepository } from './repositories/quote.repository';

/**
 * Neutral quote domain (TOV-175): the `rfq_quotes` entity + `QUOTE_REPOSITORY` port. Config-free and
 * provider-only (no route surface), so the integration harness can import it standalone. The public surface
 * lives in `PublicQuotesModule`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Quote])],
  providers: [{ provide: QUOTE_REPOSITORY, useClass: QuoteRepository }],
  exports: [QUOTE_REPOSITORY, TypeOrmModule],
})
export class QuotesModule {}
