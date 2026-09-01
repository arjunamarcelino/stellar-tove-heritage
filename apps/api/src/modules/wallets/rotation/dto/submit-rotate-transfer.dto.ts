import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsBase64Url } from '@common/validators/is-base64url.validator';

/**
 * One signed holding. Carries ONLY the WebAuthn assertion — no `txXdr`: the server verifies the assertion
 * against the unsigned tx it stored for `itemId` at build time (the body tx is never trusted).
 */
export class SubmitRotateTransferItemDto {
  @ApiProperty() @IsUUID() itemId!: string;

  @ApiProperty({ description: 'WebAuthn authenticatorData (base64url)' })
  @IsBase64Url()
  @MinLength(48)
  @MaxLength(2048)
  authenticatorData!: string;

  @ApiProperty({ description: 'WebAuthn clientDataJSON (base64url)' })
  @IsBase64Url()
  @MinLength(1)
  @MaxLength(4096)
  clientDataJSON!: string;

  @ApiProperty({ description: 'WebAuthn ECDSA signature, DER (base64url)' })
  @IsBase64Url()
  @MaxLength(256)
  signature!: string;
}

/** Submit signed assertions for one or more of a rotation's holdings. Partial (batched) submits are allowed. */
export class SubmitRotateTransferDto {
  @ApiProperty() @IsUUID() rotationId!: string;

  @ApiProperty({ type: [SubmitRotateTransferItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SubmitRotateTransferItemDto)
  items!: SubmitRotateTransferItemDto[];
}
