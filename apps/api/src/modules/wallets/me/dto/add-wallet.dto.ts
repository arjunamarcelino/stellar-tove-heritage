import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Body for `POST /me/wallets` (TOV-24): the signed SEP-10 challenge XDR proving ownership of the new
 * BYOW public key. The challenge must have been issued to the authenticated Collector via
 * `POST /me/wallets/challenge` (user-bound); verification asserts that ownership server-side.
 */
export class AddWalletDto {
  @ApiProperty({
    description: 'Signed SEP-10 challenge transaction (base64 XDR) for the new BYOW public key',
    example: 'AAAAAgAAAAA...==',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  signedChallengeXdr!: string;
}
