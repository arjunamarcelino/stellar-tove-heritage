import { ApiProperty } from '@nestjs/swagger';

export class Sep10ChallengeResponseDto {
  @ApiProperty({
    description: 'Unsigned SEP-10 challenge transaction (base64 XDR) for the wallet to sign',
    example: 'AAAAAgAAAAA...==',
  })
  challengeTxXdr!: string;

  @ApiProperty({
    description: 'Stellar network passphrase the challenge must be signed against',
    example: 'Test SDF Network ; September 2015',
  })
  networkPassphrase!: string;

  static create(data: { challengeTxXdr: string; networkPassphrase: string }): Sep10ChallengeResponseDto {
    const dto = new Sep10ChallengeResponseDto();
    dto.challengeTxXdr = data.challengeTxXdr;
    dto.networkPassphrase = data.networkPassphrase;
    return dto;
  }
}
