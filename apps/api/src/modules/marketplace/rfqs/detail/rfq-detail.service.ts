import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { failHttp } from '@common/http/fail-http';
import { ErrorCode } from '@common/enums/error-code.enum';
import { slugFallback } from '@common/utils/slug.util';
import {
  RFQ_REPOSITORY,
  IRfqRepository,
} from '../repositories/rfq-repository.interface';
import {
  QUOTE_REPOSITORY,
  IQuoteRepository,
} from '../../quotes/repositories/quote-repository.interface';
import {
  ARTWORK_REPOSITORY,
  IArtworkRepository,
} from '../../../fractionalization/repositories/artwork-repository.interface';
import { RfqDetailResponseDto } from './dto/rfq-detail-response.dto';

/**
 * Buyer RFQ-detail read (TOV-177, unblocks TOV-178): the caller's own RFQ + its OPEN quotes (backend-sorted
 * price ASC), each with the derived `acceptable` flag that gates the Accept CTA. Owner-scoped — a missing or
 * not-owned RFQ returns an identical `404 QUOTE_RFQ_NOT_FOUND` (no existence oracle). Pure DB read.
 */
@Injectable()
export class RfqDetailService {
  constructor(
    @Inject(RFQ_REPOSITORY) private readonly rfqs: IRfqRepository,
    @Inject(QUOTE_REPOSITORY) private readonly quotes: IQuoteRepository,
    @Inject(ARTWORK_REPOSITORY) private readonly artworks: IArtworkRepository,
  ) {}

  async getDetail(callerSub: string, rfqId: string): Promise<RfqDetailResponseDto> {
    const rfq = await this.rfqs.findOneById(rfqId);
    if (!rfq || rfq.collectorSub !== callerSub) {
      // Same 404 for missing and not-owned so a buyer can't probe other collectors' RFQ ids.
      throw failHttp(ErrorCode.QUOTE_RFQ_NOT_FOUND, HttpStatus.NOT_FOUND, 'RFQ not found');
    }
    const artwork = await this.artworks.findOneById(rfq.artworkId);
    const artworkSlug = artwork ? slugFallback(artwork.title, artwork.id) : null;
    const quotes = await this.quotes.findOpenQuotesForRfq(rfqId);
    return RfqDetailResponseDto.build(rfq, artworkSlug, quotes);
  }
}
