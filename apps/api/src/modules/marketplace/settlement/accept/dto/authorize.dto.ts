import { ApiProperty } from '@nestjs/swagger';
import { IsBase64, IsString, Matches, MaxLength } from 'class-validator';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Attach body: the seller's signed authorization entry + WebAuthn assertion (TOV-177 authorize). */
export class AuthorizeQuoteDto {
  @ApiProperty({ description: 'The unsigned seller auth entry from authorize/prepare (base64 XDR).' })
  @IsString()
  @IsBase64()
  @MaxLength(8192)
  sellerAuthEntryXdr!: string;

  @ApiProperty({ description: 'WebAuthn authenticatorData (base64url).' })
  @IsString()
  @MaxLength(4096)
  @Matches(BASE64URL)
  authenticatorData!: string;

  @ApiProperty({ description: 'WebAuthn clientDataJSON (base64url).' })
  @IsString()
  @MaxLength(8192)
  @Matches(BASE64URL)
  clientDataJSON!: string;

  @ApiProperty({ description: 'WebAuthn assertion signature (base64url DER).' })
  @IsString()
  @MaxLength(512)
  @Matches(BASE64URL)
  signature!: string;
}
