import { ApiProperty } from '@nestjs/swagger';
import { slugFallback } from '@common/utils/slug.util';

/**
 * Fully-resolved inputs for one holding row (TOV-237). Carries the artwork metadata plus the FINISHED
 * decimal-string amounts computed by the service (on-chain balance + derived locked/free) — the DTO does
 * no lockup math, it is a pure mapper.
 */
export interface HoldingRow {
  artworkId: string;
  artworkTitle: string;
  artworkImageUrl: string | null;
  tokenContract: string;
  artistHandle: string | null;
  balance: string;
  lockedBalance: string;
  freeBalance: string;
}

/** One fractionalized-artwork holding for `GET /v1/me/holdings`. Amounts are i128-safe decimal strings. */
export class HoldingDto {
  @ApiProperty({ format: 'uuid' })
  artworkId!: string;

  @ApiProperty()
  artworkTitle!: string;

  @ApiProperty({ description: 'Derived URL-safe slug (kebab title + id suffix); no persisted column.' })
  artworkSlug!: string;

  @ApiProperty({ type: String, nullable: true })
  artworkImageUrl!: string | null;

  @ApiProperty({ description: 'FractionToken contract address (C-StrKey).' })
  tokenContract!: string;

  @ApiProperty({ description: 'On-chain balance as a decimal string.', example: '60' })
  balance!: string;

  @ApiProperty({ description: 'Portion locked by an active artist lockup; "0" for collectors.', example: '0' })
  lockedBalance!: string;

  @ApiProperty({
    description:
      'balance − lockedBalance (never negative). ADVISORY / display-only: a 30s-cached value derived ' +
      'from an on-chain read. Sell/RFQ settlement MUST re-read the balance on-chain — never authorize a ' +
      'transfer from this value.',
    example: '60',
  })
  freeBalance!: string;

  @ApiProperty({ type: String, nullable: true })
  artistHandle!: string | null;

  /** Field-by-field mapping (no `Object.assign`, so a rename/nullable drift breaks the build). */
  static fromRow(row: HoldingRow): HoldingDto {
    const dto = new HoldingDto();
    dto.artworkId = row.artworkId;
    dto.artworkTitle = row.artworkTitle;
    dto.artworkSlug = slugFallback(row.artworkTitle, row.artworkId);
    dto.artworkImageUrl = row.artworkImageUrl;
    dto.tokenContract = row.tokenContract;
    dto.balance = row.balance;
    dto.lockedBalance = row.lockedBalance;
    dto.freeBalance = row.freeBalance;
    dto.artistHandle = row.artistHandle;
    return dto;
  }
}
