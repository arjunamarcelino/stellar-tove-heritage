import { ApiProperty } from '@nestjs/swagger';

/** authorize response: the quote is now "acceptable" until its authorization lapses. */
export class AuthorizeResponseDto {
  @ApiProperty({ format: 'uuid' })
  quoteId!: string;

  @ApiProperty({ format: 'date-time' })
  authorizedAt!: string;

  @ApiProperty({ description: 'Ledger the stored seller authorization is valid until.' })
  authExpiresLedger!: number;

  static build(quoteId: string, authorizedAt: Date, authExpiresLedger: number): AuthorizeResponseDto {
    return { quoteId, authorizedAt: authorizedAt.toISOString(), authExpiresLedger };
  }
}
