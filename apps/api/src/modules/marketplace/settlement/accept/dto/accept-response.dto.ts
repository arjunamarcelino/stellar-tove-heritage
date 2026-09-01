import { ApiProperty } from '@nestjs/swagger';
import type { SecondaryTrade } from '../../entities/secondary-trade.entity';
import type { SecondaryTradeStatus } from '../../constants/secondary-trade-status.constant';

class AcceptTradeSummaryDto {
  @ApiProperty() count!: string;
  @ApiProperty() grossStroops!: string;
  @ApiProperty() sellerNetStroops!: string;
  @ApiProperty() platformFeeStroops!: string;
  @ApiProperty() artistRoyaltyStroops!: string;
}

/** accept/prepare response: the buyer's OWN unsigned entry + the challenge to sign. */
export class AcceptPrepareResponseDto {
  @ApiProperty({ description: "The buyer's OWN unsigned auth entry (base64 XDR); the seller entry stays server-side." })
  buyerAuthEntryXdr!: string;

  @ApiProperty() challenge!: string;
  @ApiProperty() expiresAtLedger!: number;
  @ApiProperty() credentialId!: string;
  @ApiProperty({ nullable: true }) transports!: string | null;
  @ApiProperty() rpId!: string;

  @ApiProperty({ type: AcceptTradeSummaryDto })
  trade!: AcceptTradeSummaryDto;
}

/** accept 202 response. */
export class AcceptResponseDto {
  @ApiProperty({ format: 'uuid' }) tradeId!: string;
  @ApiProperty({ enum: ['pending'] }) status!: 'pending';
}

/** GET :id/accept/me poll target. */
export class TradeResponseDto {
  @ApiProperty({ format: 'uuid' }) tradeId!: string;
  @ApiProperty({ enum: ['pending', 'settled', 'failed'] }) status!: SecondaryTradeStatus;
  @ApiProperty({ format: 'uuid' }) quoteId!: string;
  @ApiProperty() count!: string;
  @ApiProperty() grossStroops!: string;
  @ApiProperty({ nullable: true }) txHash!: string | null;
  @ApiProperty({ nullable: true }) settledAt!: string | null;
  @ApiProperty({ nullable: true }) failureReason!: string | null;
  @ApiProperty({ nullable: true, description: 'Forward-compat: null until TOV-181 writes the registry event.' })
  registryEventId!: string | null;
  @ApiProperty() createdAt!: string;

  static fromEntity(t: SecondaryTrade): TradeResponseDto {
    return {
      tradeId: t.id,
      status: t.status,
      quoteId: t.quoteId,
      count: t.fractionCount,
      grossStroops: t.grossStroops,
      txHash: t.txHash,
      settledAt: t.settledAt ? t.settledAt.toISOString() : null,
      failureReason: t.failureReason,
      registryEventId: null,
      createdAt: t.createdAt.toISOString(),
    };
  }
}
