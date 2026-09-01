import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { RfqStatus } from '../constants/rfq-status.constant';
import { Rfq } from '../entities/rfq.entity';

/**
 * Soft-warn balance hint (TOV-172). Present in the 201 body ONLY when the collector's on-chain USDC looks
 * insufficient for `maxPricePerFractionStroops × fractionCount`. Tri-state for the FE: present = read
 * succeeded and funds short; absent = funds sufficient OR the balance could not be computed (no wallet / RPC
 * unavailable / timed out) OR this is a replayed response. Absence is NOT a solvency guarantee. Amounts are
 * big-integer stroop strings.
 */
export class BalanceWarningDto {
  @ApiProperty({ type: String, description: 'maxPricePerFractionStroops × fractionCount (stroops)' })
  requiredStroops!: string;

  @ApiProperty({ type: String, description: "The collector's embedded-wallet USDC balance (stroops)" })
  availableStroops!: string;
}

/**
 * The created RFQ resource (TOV-172, FR-06.01). Money stays a string; the entity is never exposed directly.
 * `balanceWarning` is present only on the FRESH 201 when the soft-warn balance read found insufficient funds
 * (never on a replay).
 */
export class RfqResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() collectorSub!: string;
  @ApiProperty() artworkId!: string;
  @ApiProperty() fractionContractId!: string;
  @ApiProperty({ type: String, description: 'Fraction count' }) fractionCount!: string;
  @ApiProperty({ type: String, description: 'Max price per fraction (stroops)' })
  maxPricePerFractionStroops!: string;
  @ApiProperty({ description: 'open | filled | canceled | expired', example: 'open' })
  status!: RfqStatus;
  @ApiProperty({ description: 'createdAt + (expiryHours ?? 48)h (ISO-8601 UTC)' })
  expiresAt!: string;
  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional({ type: BalanceWarningDto })
  balanceWarning?: BalanceWarningDto;

  static fromEntity(rfq: Rfq, warning?: BalanceWarningDto): RfqResponseDto {
    const dto = new RfqResponseDto();
    dto.id = rfq.id;
    dto.collectorSub = rfq.collectorSub;
    dto.artworkId = rfq.artworkId;
    dto.fractionContractId = rfq.fractionContractId;
    dto.fractionCount = rfq.fractionCount;
    dto.maxPricePerFractionStroops = rfq.maxPricePerFractionStroops;
    dto.status = rfq.status;
    dto.expiresAt = rfq.expiresAt.toISOString();
    dto.createdAt = rfq.createdAt.toISOString();
    if (warning) {
      dto.balanceWarning = warning;
    }
    return dto;
  }
}
