import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { QuoteStatus } from '../constants/quote-status.constant';
import { Quote } from '../entities/quote.entity';

/**
 * `POST /marketplace/rfqs/:id/quotes` response (TOV-175). Never exposes the entity directly. Money/counts stay
 * strings (BigInt precision); dates are ISO-8601. `validUntilCapped` is present+true ONLY when the requested
 * `validUntil` was capped to the RFQ's expiry — it is part of the stored idempotency snapshot so a Redis
 * replay is byte-identical (the rare durable-backstop replay reconstructs from the row and omits the flag).
 *
 * NB: deliberately does NOT expose `holderSub` (the caller's internal JWT sub) — the submitter already knows
 * their identity, and never leaking a `sub` keeps this consistent with the rest of the API (TOV-175 #376). A
 * future cross-actor quote read (FR-06.04, where the RFQ buyer sees holders' quotes) must project a
 * pseudonymous handle, not this field.
 */
export class QuoteResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() rfqId!: string;
  @ApiProperty() fractionContractId!: string;
  @ApiProperty({ type: String, description: 'Fractions offered to sell' }) fractionCount!: string;
  @ApiProperty({ type: String, description: 'Ask price per fraction (stroops)' })
  pricePerFractionStroops!: string;
  @ApiProperty({ description: 'ISO-8601 UTC; possibly capped to the RFQ expiry' }) validUntil!: string;
  @ApiPropertyOptional({ description: 'true when validUntil was capped to the RFQ expiry', example: true })
  validUntilCapped?: boolean;
  @ApiProperty({ description: 'open | accepted | canceled | expired', example: 'open' })
  status!: QuoteStatus;
  @ApiProperty() createdAt!: string;

  static fromEntity(quote: Quote, opts?: { validUntilCapped?: boolean }): QuoteResponseDto {
    const dto = new QuoteResponseDto();
    dto.id = quote.id;
    dto.rfqId = quote.rfqId;
    dto.fractionContractId = quote.fractionContractId;
    dto.fractionCount = quote.fractionCount;
    dto.pricePerFractionStroops = quote.pricePerFractionStroops;
    dto.validUntil = quote.validUntil.toISOString();
    dto.status = quote.status;
    dto.createdAt = quote.createdAt.toISOString();
    if (opts?.validUntilCapped) {
      dto.validUntilCapped = true;
    }
    return dto;
  }
}
