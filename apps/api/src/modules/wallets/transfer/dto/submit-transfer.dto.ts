import { ApiProperty } from '@nestjs/swagger';
import { IsBase64, IsString, MaxLength, MinLength } from 'class-validator';
import { IsBase64Url } from '@common/validators/is-base64url.validator';

/**
 * Submit a built transfer with the round-tripped WebAuthn assertion. The backend re-verifies the
 * assertion against the wallet's bound passkey and the tx's auth entry before submitting; it never
 * submits without a valid signature. Tight per-field length caps bound abuse and keep malformed
 * input a clean 400 (never a 500).
 */
export class SubmitTransferDto {
  @ApiProperty({ description: 'The unsigned transfer transaction from /build (base64 XDR)' })
  @IsString()
  @IsBase64()
  @MaxLength(8192)
  txXdr!: string;

  @ApiProperty({ description: 'WebAuthn authenticatorData (base64url)' })
  @IsBase64Url()
  @MinLength(48) // abuse-bounding only (~36B); the authoritative `>= 37 raw bytes` check is in the verifier
  @MaxLength(2048)
  authenticatorData!: string;

  @ApiProperty({ description: 'WebAuthn clientDataJSON (base64url)' })
  @IsBase64Url()
  @MaxLength(4096)
  clientDataJSON!: string;

  @ApiProperty({ description: 'WebAuthn ECDSA signature, DER (base64url)' })
  @IsBase64Url()
  @MaxLength(256)
  signature!: string;
}
