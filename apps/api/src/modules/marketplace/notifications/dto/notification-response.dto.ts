import { ApiProperty } from '@nestjs/swagger';
import { slugFallback } from '@common/utils/slug.util';
import { RFQ_STATUSES, RfqStatus } from '@modules/marketplace/rfqs/constants/rfq-status.constant';
import { NotificationRow } from '../repositories/rfq-notification-repository.interface';

/**
 * One RFQ notification for `GET /me/notifications` (TOV-174). Read-time join to the live RFQ (status/terms)
 * + artwork (display); `artworkSlug` is derived (no column). Deliberately does NOT expose the RFQ issuer's
 * identity (`collector_sub`) — the buyer stays pseudonymous to holders. `maxPricePerFractionStroops` (the
 * buyer's ceiling) IS exposed: the intended RFQ price-discovery disclosure. Amounts are decimal strings.
 */
export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Notification id (use for PATCH :id/read).' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  rfqId!: string;

  @ApiProperty({ format: 'uuid' })
  artworkId!: string;

  @ApiProperty()
  artworkTitle!: string;

  @ApiProperty({ description: 'Derived URL-safe slug (kebab title + id suffix); no persisted column.' })
  artworkSlug!: string;

  @ApiProperty({ type: String, nullable: true })
  artworkImageUrl!: string | null;

  @ApiProperty({ description: 'Fractions the buyer wants to buy (from the RFQ).', example: '100' })
  fractionCount!: string;

  @ApiProperty({ description: 'Buyer max price per fraction in USDC stroops (decimal string).', example: '150000000' })
  maxPricePerFractionStroops!: string;

  @ApiProperty({ enum: RFQ_STATUSES, description: 'LIVE RFQ status (joined at read time).' })
  rfqStatus!: RfqStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  rfqExpiresAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'null = unread.' })
  readAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  /** Field-by-field mapping (no `Object.assign`, so a rename/nullable drift breaks the build). */
  static fromRow(row: NotificationRow): NotificationResponseDto {
    const dto = new NotificationResponseDto();
    dto.id = row.id;
    dto.rfqId = row.rfqId;
    dto.artworkId = row.artworkId;
    dto.artworkTitle = row.artworkTitle;
    dto.artworkSlug = slugFallback(row.artworkTitle, row.artworkId);
    dto.artworkImageUrl = row.artworkImageUrl;
    dto.fractionCount = row.fractionCount;
    dto.maxPricePerFractionStroops = row.maxPricePerFractionStroops;
    dto.rfqStatus = row.rfqStatus;
    dto.rfqExpiresAt = row.rfqExpiresAt.toISOString();
    dto.readAt = row.readAt ? row.readAt.toISOString() : null;
    dto.createdAt = row.createdAt.toISOString();
    return dto;
  }
}
