import { ApiProperty } from '@nestjs/swagger';
import { IsBase64, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** accept/prepare body: the quote the buyer chooses. */
export class AcceptPrepareDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  quoteId!: string;
}

/** accept body: the chosen quote + the buyer's OWN signed auth entry + WebAuthn assertion. */
export class AcceptDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  quoteId!: string;

  @ApiProperty({ description: "The buyer's unsigned auth entry from accept/prepare (base64 XDR)." })
  @IsString()
  @IsBase64()
  @MaxLength(8192)
  buyerAuthEntryXdr!: string;

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
