import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches, MaxLength } from 'class-validator';
import { IsStellarAddress } from '@common/validators/is-stellar-address.validator';
import { DECIMAL_STRING_RE } from '../amount';

/**
 * Request to build an unsigned USDC transfer from the caller's embedded smart-wallet. The `from`
 * wallet is derived from the JWT (owner-scoped), never the body. USDC-only this ticket, so there is
 * no `asset` field.
 */
export class BuildTransferDto {
  @ApiProperty({
    description: 'Recipient Stellar address (G... account or C... contract)',
    example: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
  })
  @IsStellarAddress()
  to!: string;

  @ApiProperty({
    description: 'Amount of USDC to transfer, as a decimal string (max 7 fractional digits)',
    example: '10.5',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40) // bounds abuse; i128 range is enforced during scaling
  @Matches(DECIMAL_STRING_RE, { message: 'amount must be a non-negative decimal string' })
  amount!: string;
}
