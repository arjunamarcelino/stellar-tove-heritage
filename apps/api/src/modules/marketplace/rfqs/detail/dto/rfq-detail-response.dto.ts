import { ApiProperty } from '@nestjs/swagger';
import type { Rfq } from '../../entities/rfq.entity';
import type { OpenQuoteRow } from '../../../quotes/repositories/quote-repository.interface';

/** One OPEN quote on the buyer's RFQ (TOV-177 read). `acceptable` gates the per-row Accept CTA. */
export class QuoteRowDto {
  @ApiProperty({ format: 'uuid' })
  quoteId!: string;

  @ApiProperty({ nullable: true, description: 'Pseudonymous seller handle; null for a wallet-only holder.' })
  sellerHandle!: string | null;

  @ApiProperty({ description: 'Fractions offered (i128 decimal string).' })
  fractionCount!: string;

  @ApiProperty({ description: 'Ask per fraction (USDC stroops, i128 decimal string).' })
  pricePerFractionStroops!: string;

  @ApiProperty({ description: 'count × price — what the buyer pays (i128 decimal string).' })
  grossStroops!: string;

  @ApiProperty({ format: 'date-time' })
  validUntil!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ description: 'open AND the seller has a valid stored authorization — enables the Accept CTA.' })
  acceptable!: boolean;
}

/** The buyer's RFQ detail with its OPEN quotes (backend-sorted price ASC). */
export class RfqDetailResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  artworkId!: string;

  @ApiProperty({ nullable: true, description: 'Derived URL slug; null if the artwork is unavailable.' })
  artworkSlug!: string | null;

  @ApiProperty({ description: "The buyer's requested fraction count (advisory)." })
  fractionCount!: string;

  @ApiProperty({ description: 'The buyer max price per fraction (advisory, USDC stroops).' })
  maxPricePerFractionStroops!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: [QuoteRowDto] })
  quotes!: QuoteRowDto[];

  static build(rfq: Rfq, artworkSlug: string | null, quotes: OpenQuoteRow[]): RfqDetailResponseDto {
    return {
      id: rfq.id,
      artworkId: rfq.artworkId,
      artworkSlug,
      fractionCount: rfq.fractionCount,
      maxPricePerFractionStroops: rfq.maxPricePerFractionStroops,
      expiresAt: rfq.expiresAt.toISOString(),
      status: rfq.status,
      createdAt: rfq.createdAt.toISOString(),
      quotes: quotes.map((r) => ({
        quoteId: r.quoteId,
        sellerHandle: r.sellerHandle,
        fractionCount: r.fractionCount,
        pricePerFractionStroops: r.pricePerFractionStroops,
        grossStroops: r.grossStroops,
        validUntil: new Date(r.validUntil).toISOString(),
        status: r.status,
        acceptable: r.acceptable,
      })),
    };
  }
}
