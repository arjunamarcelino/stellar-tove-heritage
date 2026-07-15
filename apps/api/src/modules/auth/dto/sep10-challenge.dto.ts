import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class Sep10ChallengeDto {
  @ApiProperty({
    description: 'Stellar account public key (StrKey, ed25519) requesting the challenge',
    example: 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O',
  })
  // Stellar ed25519 StrKey: 'G' + 55 base32 chars. Full crypto validity is
  // re-checked by the SDK when building the challenge.
  @Matches(/^G[A-Z2-7]{55}$/, { message: 'publicKey must be a valid Stellar public key' })
  publicKey!: string;
}
