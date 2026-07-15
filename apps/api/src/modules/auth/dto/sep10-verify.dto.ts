import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class Sep10VerifyDto {
  @ApiProperty({
    description: 'The challenge transaction, signed by the wallet, as a base64 XDR string',
    example: 'AAAAAgAAAAA...==',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192) // a signed SEP-10 challenge is well under this; bounds abuse
  challengeTxXdr!: string;
}
